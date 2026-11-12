import { insetPolygon } from '../panel'
import type { PanelShape } from '../panel-shape'
import { ringArea } from '../planar/clipper'
import type { Vec2 } from '../vec3'

import { congruences, convexHull, rot, rotatedBounds, wrapAngle } from './convex'
import type { NestPlacement, NestSettings, RotationMode } from './types'

/**
 * Part preparation for nesting (plan §13.3 Parts, §13.4 step 3).
 *
 * Frames:
 * - **reference frame**: the panel's face frame in free rotation mode, its north-up export frame
 *   otherwise. `NestPlacement`s are relative to it.
 * - **canonical frame**: each distinct shape's own frame. Congruent panels share one canonical
 *   polygon, so the nester only ever sees a few shapes, and NFPs are cached per shape pair.
 *
 * A part's polygon in its reference frame is R(phi) · canonical + t. The nester places the
 * canonical polygon on a sheet as R(alpha) · canonical + T.
 */

/**
 * Near-collinear hull vertices within this distance (mm) are dropped (see `convexHull`). Kerf
 * offsets go through Clipper's 0.001 mm grid, so collinear points carry about that much noise.
 */
export const HULL_TOL_MM = 0.005
/** Congruent shapes match when every vertex is within this distance (mm). */
export const MATCH_TOL_MM = 0.005

export interface NestShape {
  /**
   * The convex hull of the cut path, offset outward by gap/2 (+ the tolerances) with mitred
   * corners: CCW, strictly convex, mm, centred on its area centroid (so symmetry rotations
   * about the origin map it onto itself). Two parts whose shapes don't overlap are at least the gap
   * apart.
   */
  readonly polygon: readonly Vec2[]
  readonly area: number
  /** Order of rotational symmetry: rotating by 2π / symmetry maps the polygon onto itself. */
  readonly symmetry: number
}

export interface NestPart {
  readonly face: number
  /** Index into `PreparedParts.shapes`. */
  readonly shape: number
  /** Reference-frame polygon = R(phi) · canonical + t. */
  readonly phi: number
  readonly t: Vec2
  /**
   * The orientations the part may take that fit the sheet, distinct modulo the shape's symmetry,
   * by ascending `alpha`. Never empty: parts that fit at no angle are listed in
   * `PreparedParts.unplaced` instead.
   */
  readonly angles: readonly PartAngle[]
}

/**
 * One allowed orientation. `alpha` (canonical frame, in [0, 2π / symmetry)) is what the nester
 * uses; `theta` is the actual rotation of the panel's reference frame, an allowed angle for the
 * rotation mode. θ + φ ≡ α modulo the symmetry period, so both give the same outline on the
 * sheet, but only `theta` puts the engraving the right way round.
 */
export interface PartAngle {
  readonly alpha: number
  readonly theta: number
}

/** Where parts' (inflated) polygons must lie, in sheet mm, y up from the bottom-left corner. */
export interface Bin {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface PreparedParts {
  readonly shapes: readonly NestShape[]
  readonly parts: readonly NestPart[]
  /** Faces that fit the sheet at no allowed angle, ascending. */
  readonly unplaced: readonly number[]
  readonly bin: Bin
}

const DEG = Math.PI / 180
const ANGLE_EPS = 1e-9

/** Area centroid of a polygon. */
function centroid(poly: readonly Vec2[]): Vec2 {
  let a = 0
  let cx = 0
  let cy = 0
  poly.forEach(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % poly.length]!
    const c = x0 * y1 - x1 * y0
    a += c
    cx += (x0 + x1) * c
    cy += (y0 + y1) * c
  })
  return [cx / (3 * a), cy / (3 * a)]
}

/** The panel's cut path in its reference frame. */
export function referenceOutline(panel: PanelShape, mode: RotationMode): Vec2[] {
  return mode === 'free'
    ? [...panel.cutOutline]
    : panel.cutOutline.map((p) => rot(p, panel.rotation))
}

/** Allowed angles in the reference frame, radians. Free mode steps through a full turn. */
function referenceAngles(nest: NestSettings): number[] {
  switch (nest.rotationMode) {
    case 'free': {
      const n = Math.round(360 / nest.rotationStepDeg)
      return Array.from({ length: n }, (_, k) => k * nest.rotationStepDeg * DEG)
    }
    case '90':
      return [0, 90, 180, 270].map((d) => d * DEG)
    case '180':
      return [0, Math.PI]
    case 'none':
      return [0]
  }
}

/**
 * The orientations for a part, distinct modulo the shape's symmetry, by ascending alpha. In free
 * mode the reference frame is arbitrary, so the step grid is laid on the canonical frame instead,
 * which keeps every congruent part on the same alphas (and the NFP cache small).
 */
function partAngles(nest: NestSettings, phi: number, symmetry: number): PartAngle[] {
  const period = (2 * Math.PI) / symmetry
  const snap = (w: number) => (period - w < ANGLE_EPS ? 0 : w)
  const out: PartAngle[] = []
  for (const a of referenceAngles(nest)) {
    const free = nest.rotationMode === 'free'
    const alpha = snap(wrapAngle(free ? a : a + phi, period))
    if (free && a >= period - ANGLE_EPS) break
    if (out.some((o) => Math.abs(o.alpha - alpha) < ANGLE_EPS)) continue
    out.push({ alpha, theta: free ? wrapAngle(alpha - phi) : a })
  }
  return out.sort((x, y) => x.alpha - y.alpha)
}

/** The region inflated polygons must stay in: the sheet inset by margin − gap/2. */
export function binFor(nest: NestSettings): Bin {
  const inset = nest.marginMm - nest.gapMm / 2
  return {
    minX: inset,
    minY: inset,
    maxX: nest.sheetWidthMm - inset,
    maxY: nest.sheetHeightMm - inset,
  }
}

/** True if the polygon rotated by `rad` fits in the bin somewhere. */
export function fitsBin(poly: readonly Vec2[], rad: number, bin: Bin): boolean {
  const b = rotatedBounds(poly, rad)
  return b.maxX - b.minX <= bin.maxX - bin.minX && b.maxY - b.minY <= bin.maxY - bin.minY
}

/**
 * Hull, inflate and deduplicate every panel, and list the angles each may use (plan §13.3).
 * `panels` come from `panelShapes`, with `north` given when the rotation mode isn't free.
 */
export function prepareParts(panels: readonly PanelShape[], nest: NestSettings): PreparedParts {
  const bin = binFor(nest)
  // The hull is within HULL_TOL of the cut path; a shared canonical polygon is within MATCH_TOL
  // of each part's own; and a symmetry rotation (θ + φ ≡ α only modulo the period) maps it onto
  // itself within another MATCH_TOL. Growing the offset by all three keeps the gap exact.
  const offset = nest.gapMm / 2 + HULL_TOL_MM + 2 * MATCH_TOL_MM
  const shapes: NestShape[] = []
  const parts: NestPart[] = []
  const unplaced: number[] = []

  for (const panel of panels) {
    const hull = convexHull(referenceOutline(panel, nest.rotationMode), HULL_TOL_MM)
    const polygon = insetPolygon(
      hull,
      hull.map(() => -offset),
    )
    let shape = -1
    let phi = 0
    let t: Vec2 = [0, 0]
    for (let i = 0; i < shapes.length && shape < 0; i++) {
      const [match] = congruences(shapes[i]!.polygon, polygon, MATCH_TOL_MM)
      if (match) {
        shape = i
        phi = match.rotation
        t = match.translation
      }
    }
    if (shape < 0) {
      // New shape: canonical = this polygon, centred on its centroid.
      const [ox, oy] = centroid(polygon)
      const canonical = polygon.map(([x, y]): Vec2 => [x - ox, y - oy])
      shape = shapes.length
      shapes.push({
        polygon: canonical,
        area: ringArea(canonical),
        symmetry: congruences(canonical, canonical, MATCH_TOL_MM).length,
      })
      t = [ox, oy]
    }
    const s = shapes[shape]!
    const angles = partAngles(nest, phi, s.symmetry).filter((a) => fitsBin(s.polygon, a.alpha, bin))
    if (angles.length === 0) unplaced.push(panel.faceIndex)
    else parts.push({ face: panel.faceIndex, shape, phi, t, angles })
  }
  return { shapes, parts, unplaced: unplaced.sort((a, b) => a - b), bin }
}

/**
 * Convert a nester result (the canonical polygon placed as R(alpha) · c + T, with alpha from
 * `angle`) into a placement of the panel's reference frame: R(theta) · p + (x, y).
 */
export function toPlacement(
  part: NestPart,
  sheet: number,
  angle: PartAngle,
  T: Vec2,
): NestPlacement {
  const [rx, ry] = rot(part.t, angle.theta)
  return { face: part.face, sheet, x: T[0] - rx, y: T[1] - ry, angleDeg: angle.theta / DEG }
}

/** Apply a placement to a point in the panel's reference frame. */
export function placePoint(p: Vec2, placement: NestPlacement): Vec2 {
  const [x, y] = rot(p, placement.angleDeg * DEG)
  return [x + placement.x, y + placement.y]
}
