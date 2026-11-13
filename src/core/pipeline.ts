import { type Cap, boundingCap, capsOverlap, faceCap, polygonCap } from './clip/cull'
import type { Paths64 } from 'clipper2-ts'

import { clipRingToCone } from './clip/polygon'
import { clipPolylineToCone } from './clip/polyline'
import type { SphereRings } from './geo/lines'
import type { PreparedStar } from './geo/sky'
import type { FillLayerId, LineSourceId } from './layers'
import { BUTT, type JointOptions, fingerReach, fingerSafeInterior } from './joints'
import { polygonConePlanes } from './panel'
import { panelModel } from './panel-shape'
import {
  clipPolylines,
  fromPaths64,
  intersection,
  offsetPolygon,
  subtract,
  toPaths64,
  unionPositive,
} from './planar/clipper'
import { roundPolyline } from './planar/round'
import { type FaceFrame, type PolyhedronFrames, planePoint } from './polyhedron/faces'
import { gnomonic } from './project/gnomonic'
import { northUpRotation } from './project/orientation'
import { IDENTITY, type Quat, rotate } from './quat'
import {
  type StarOptions,
  circleRing,
  isHole,
  largestStarMm,
  mainRing,
  sortHoles,
  starSizeMm,
} from './stars'
import { type Vec2, type Vec3, distance } from './vec3'

/** A unit-vector polyline with its bounding cap, for culling. */
export interface PreparedLine {
  readonly points: readonly Vec3[]
  readonly cap: Cap
}

/** A polygon (open rings of unit vectors, d3 winding) with its bounding cap. */
export interface PreparedPolygon {
  readonly rings: readonly (readonly Vec3[])[]
  readonly cap: Cap
}

/** Source polygons; ocean is derived per face (plan §4.2). */
export type PolygonSourceId = 'land' | 'lakes' | 'milkyWay' | 'maria' | 'craterShadows'

/** Map data prepared once per dataset (plan §4.2). */
export interface PreparedMap {
  readonly lines: Partial<Record<LineSourceId, readonly PreparedLine[]>>
  readonly polygons: Partial<Record<PolygonSourceId, readonly PreparedPolygon[]>>
  /** Stars, for the sky (plan §15). */
  readonly stars?: readonly PreparedStar[]
}

/**
 * One face's output in mm, in the face's own (u, v) frame: y up, origin at the face foot
 * point. Independent of the UI and of SVG (plan §4.4).
 */
export interface FaceArtwork {
  readonly faceIndex: number
  /**
   * Rotation applied to the face frame for export (radians, CCW, y up): output = R · frame.
   * 0 unless north-up orientation was requested.
   */
  readonly rotation: number
  /**
   * The panel as cut (before kerf), CCW: the true face, with each edge inset for square-cut butt
   * joints when a thickness is given (plan §3), with finger joints (plan §12), or the true face
   * plus the sanding allowance for sanded bevels (plan §14). Engraving covers all of it,
   * including finger tips and allowance strips that reach past the true edge.
   */
  readonly outline: readonly Vec2[]
  /** Path to cut: the outline offset outward by kerf/2, or the outline itself (plan §3 Kerf). */
  readonly cutOutline: readonly Vec2[]
  /**
   * Star holes wholly inside the panel, as cut paths (shrunk by kerf/2 when kerf is on), on the
   * Star holes layer (plan §15.2). Holes crossing the outline are notches in it instead. Present
   * only when holes were requested.
   */
  readonly holes?: readonly (readonly Vec2[])[]
  /** Bevel mode only: the engraved sanding guide at the true face edge (plan §14.1). */
  readonly guide?: readonly Vec2[]
  /** Projected linework per source. */
  readonly lines: Partial<Record<LineSourceId, readonly Vec2[][]>>
  /** Fill regions per layer: CCW exteriors, CW holes (render with even-odd or non-zero). */
  readonly fills: Partial<Record<FillLayerId, readonly Vec2[][]>>
}

export interface ArtworkOptions {
  /** Model units → mm. */
  readonly mmPerUnit: number
  /** Output grid in mm; null to skip rounding (tests, live previews). */
  readonly precisionMm: number | null
  /** Which fills to compute (they cost far more than linework). Default: none. */
  readonly fills?: Readonly<Partial<Record<FillLayerId, boolean>>>
  /**
   * Geographic north in world space (globe rotation applied to +z). When given, each panel is
   * rotated north-up (plan §3); otherwise output stays in the face's own frame.
   */
  readonly north?: Vec3
  /** Laser kerf in mm; the cut path is offset outward by half of it. 0 / absent = off. */
  readonly kerfMm?: number
  /**
   * Material thickness in mm. Panel edges are inset so square-cut panels meet at their inner
   * corners (plan §3). 0 / absent = the true face (zero-thickness panels).
   */
  readonly thicknessMm?: number
  /** Joint style (plan §12, §14). Default: square-cut butt joints. */
  readonly joint?: JointOptions
  /** How to draw the map's stars, if it has any (plan §15). */
  readonly stars?: StarOptions
}

/** Bundle linework and polygons with bounding caps. */
export function prepareMap(
  lines: Partial<Record<LineSourceId, readonly Vec3[][]>>,
  polygons: Partial<Record<PolygonSourceId, readonly SphereRings[]>> = {},
  stars?: readonly PreparedStar[],
): PreparedMap {
  const outLines: Partial<Record<LineSourceId, PreparedLine[]>> = {}
  for (const [id, ls] of Object.entries(lines) as [LineSourceId, Vec3[][]][]) {
    outLines[id] = ls.map((points) => ({ points, cap: boundingCap(points) }))
  }
  const outPolys: Partial<Record<PolygonSourceId, PreparedPolygon[]>> = {}
  for (const [id, ps] of Object.entries(polygons) as [PolygonSourceId, SphereRings[]][]) {
    outPolys[id] = ps.map((rings) => ({ rings, cap: boundingCap(rings.flat()) }))
  }
  return { lines: outLines, polygons: outPolys, ...(stars && { stars }) }
}

/** Longest edge of the solid in model units (plan §3: longest edge = N mm). */
export function longestEdge(frames: PolyhedronFrames): number {
  const v = frames.def.vertices
  return Math.max(...frames.edges.map((e) => distance(v[e.a]!, v[e.b]!)))
}

/** Apply the globe rotation to all prepared vectors (plan §4.3). */
export function rotateMap(map: PreparedMap, q: Quat): PreparedMap {
  if (q.every((c, i) => c === IDENTITY[i])) return map
  const rotCap = (cap: Cap): Cap => ({ centre: rotate(q, cap.centre), radius: cap.radius })
  const lines: Partial<Record<LineSourceId, PreparedLine[]>> = {}
  for (const [id, ls] of Object.entries(map.lines) as [LineSourceId, PreparedLine[]][]) {
    lines[id] = ls.map(({ points, cap }) => ({
      points: points.map((p) => rotate(q, p)),
      cap: rotCap(cap),
    }))
  }
  const polygons: Partial<Record<PolygonSourceId, PreparedPolygon[]>> = {}
  for (const [id, ps] of Object.entries(map.polygons) as [PolygonSourceId, PreparedPolygon[]][]) {
    polygons[id] = ps.map(({ rings, cap }) => ({
      rings: rings.map((r) => r.map((p) => rotate(q, p))),
      cap: rotCap(cap),
    }))
  }
  const stars = map.stars?.map(({ dir, mag }) => ({ dir: rotate(q, dir), mag }))
  return { lines, polygons, ...(stars && { stars }) }
}

/** Face-frame (model units) → output mm: scale, then the panel's export rotation. */
interface OutputTransform {
  readonly face: FaceFrame
  /** cos·scale, sin·scale */
  readonly a: number
  readonly b: number
}

const toOutput = ({ a, b }: OutputTransform, [x, y]: Vec2): Vec2 => [a * x - b * y, b * x + a * y]

function projectRun(t: OutputTransform, run: readonly Vec3[]): Vec2[] {
  return run.map((p) => {
    const xy = gnomonic(t.face, p)
    // Clipped points are inside the face cone, so always in front of the plane.
    if (!xy) throw new Error(`face ${t.face.index}: clipped point behind the face plane`)
    return toOutput(t, xy)
  })
}

/**
 * Clip a polygon set to the face on the sphere, project, and union in 2D. Rings are reversed
 * on projection: d3 exteriors are clockwise seen from outside, and the face frame is seen from
 * outside, so this makes exteriors counter-clockwise for Clipper's Positive fill rule.
 */
function projectPolygons(
  t: OutputTransform,
  cap: Cap,
  planes: readonly Vec3[],
  polygons: readonly PreparedPolygon[],
) {
  const rings: Vec2[][] = []
  for (const poly of polygons) {
    if (!capsOverlap(cap, poly.cap)) continue
    for (const ring of poly.rings) {
      const clipped = clipRingToCone(ring, planes)
      if (clipped.length >= 3) rings.push(projectRun(t, clipped).reverse())
    }
  }
  return unionPositive(toPaths64(rings))
}

/** True if `p` is inside (or on) the convex CCW polygon `poly`. */
function insideConvex(poly: readonly Vec2[], [x, y]: Vec2): boolean {
  return poly.every(([ax, ay], k) => {
    const [bx, by] = poly[(k + 1) % poly.length]!
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0
  })
}

/** Clip, project, scale and round one face's artwork (plan §4.4). `map` is already rotated. */
export function buildFaceArtwork(
  frames: PolyhedronFrames,
  faceIndex: number,
  map: PreparedMap,
  {
    mmPerUnit,
    precisionMm,
    fills: want = {},
    north,
    kerfMm = 0,
    thicknessMm = 0,
    joint = BUTT,
    stars: starOptions,
  }: ArtworkOptions,
): FaceArtwork {
  const face = frames.faces[faceIndex]
  if (!face) throw new Error(`no face ${faceIndex}`)
  const finish = (pts: Vec2[]) => (precisionMm === null ? pts : roundPolyline(pts, precisionMm))
  const rotation = north ? northUpRotation(face, north) : 0
  const t: OutputTransform = {
    face,
    a: Math.cos(rotation) * mmPerUnit,
    b: Math.sin(rotation) * mmPerUnit,
  }

  const {
    outline: panel,
    guide,
    fingers,
  } = panelModel(frames, faceIndex, thicknessMm, mmPerUnit, joint)
  // Butt panels are convex and lie within the true face: clip on the sphere to the panel's cone,
  // which is exact because gnomonic projection maps its planes to the panel edges (with no
  // thickness these are the face's own, shared-edge exact planes), and cull with the face's cap.
  // Bevel panels are convex too but reach past the true edge by the sanding allowance: clip to
  // their cone the same way, and cull with a cap around the whole panel (plan §14.1).
  // Fingered panels are not convex and their fingers may reach past the true edge: clip on the
  // sphere to a convex polygon containing the whole panel, then in 2D to the cut outline, so the
  // map runs all the way into the fingers (plan §12.2 Engraving).
  const reach = fingers ? fingerReach(frames, faceIndex, fingers) : null
  const cap = reach
    ? polygonCap(
        face,
        reach.map((p) => planePoint(face, p)),
      )
    : guide && panel !== guide
      ? polygonCap(
          face,
          panel.map((p) => planePoint(face, p)),
        )
      : faceCap(face)
  const planes = reach
    ? polygonConePlanes(face, reach)
    : thicknessMm > 0 || (guide && panel !== guide)
      ? polygonConePlanes(face, panel)
      : face.edgePlanes
  const outlineExact = panel.map((p) => toOutput(t, p))
  const region = fingers ? toPaths64([outlineExact]) : null
  // Lines entirely inside this convex polygon need no 2D clipping.
  const safe = fingers
    ? fingerSafeInterior(frames, faceIndex, fingers)?.map((p) => toOutput(t, p))
    : null

  // Stars (plan §15.1): circles centred where each star projects onto this panel's plane, clipped
  // to the panel in 2D. Holes cut through; those crossing the outline notch it.
  let panelRegion = region ?? toPaths64([outlineExact])
  let notched: Vec2[] | null = null
  let holes: Vec2[][] | undefined
  let noEngrave: Paths64 = []
  const dots: Vec2[][] = []
  if (starOptions && map.stars) {
    const reachMm = largestStarMm(starOptions) / 2
    const xs = outlineExact.map((p) => p[0])
    const ys = outlineExact.map((p) => p[1])
    const [x0, x1] = [Math.min(...xs) - reachMm, Math.max(...xs) + reachMm]
    const [y0, y1] = [Math.min(...ys) - reachMm, Math.max(...ys) + reachMm]
    const circles: Vec2[][] = []
    for (const { dir, mag } of map.stars) {
      if (mag > starOptions.magLimit) continue
      const xy = gnomonic(face, dir)
      if (!xy) continue
      const c = toOutput(t, xy)
      if (c[0] < x0 || c[0] > x1 || c[1] < y0 || c[1] > y1) continue
      ;(isHole(mag, starOptions) ? circles : dots).push(circleRing(c, starSizeMm(mag, starOptions)))
    }
    if (starOptions.holes) {
      const sorted = sortHoles(circles, panelRegion)
      if (sorted.panel !== panelRegion) {
        panelRegion = sorted.panel
        notched = mainRing(panelRegion, outlineExact[0]!)
      }
      noEngrave = sorted.all
      holes = sorted.inside.map((h) => {
        const cut = kerfMm > 0 ? offsetPolygon(h, -kerfMm / 2) : h
        return finish(cut)
      })
    }
  }
  /** The panel minus every hole: where engraving can go. */
  const engraveRegion = noEngrave.length > 0 ? subtract(panelRegion, noEngrave) : panelRegion

  const lines: Partial<Record<LineSourceId, Vec2[][]>> = {}
  for (const [id, ls] of Object.entries(map.lines) as [LineSourceId, PreparedLine[]][]) {
    const polylines: Vec2[][] = []
    const toClip: Vec2[][] = []
    for (const line of ls) {
      if (!capsOverlap(cap, line.cap)) continue
      for (const run of clipPolylineToCone(line.points, planes)) {
        const pts = projectRun(t, run)
        if (region && !(safe && pts.every((p) => insideConvex(safe, p)))) toClip.push(pts)
        else polylines.push(pts)
      }
    }
    if (region) polylines.push(...clipPolylines(toClip, region))
    lines[id] = polylines.map(finish).filter((pts) => pts.length >= 2)
  }
  if (dots.length > 0) {
    const rings = dots.map((d) => [...d, d[0]!])
    lines.starRings = clipPolylines(rings, engraveRegion)
      .map(finish)
      .filter((pts) => pts.length >= 2)
  }

  const fills: Partial<Record<FillLayerId, Vec2[][]>> = {}
  if (want.land || want.ocean || want.lakes) {
    const polys = (id: PolygonSourceId) => {
      const projected = projectPolygons(t, cap, planes, map.polygons[id] ?? [])
      return region ? intersection(projected, region) : projected
    }
    const land = want.land || want.ocean ? polys('land') : []
    const lakes = want.land || want.lakes ? polys('lakes') : []
    // Land excludes lakes, so a land fill never engraves over open water.
    if (want.land) fills.land = fromPaths64(subtract(land, lakes), precisionMm)
    if (want.lakes) fills.lakes = fromPaths64(lakes, precisionMm)
    if (want.ocean) {
      fills.ocean = fromPaths64(subtract(region ?? toPaths64([outlineExact]), land), precisionMm)
    }
  }
  if (want.milkyWay) {
    const milkyWay = projectPolygons(t, cap, planes, map.polygons.milkyWay ?? [])
    fills.milkyWay = fromPaths64(intersection(milkyWay, engraveRegion), precisionMm)
  }
  for (const id of ['maria', 'craterShadows'] as const) {
    if (!want[id]) continue
    const projected = projectPolygons(t, cap, planes, map.polygons[id] ?? [])
    fills[id] = fromPaths64(intersection(projected, engraveRegion), precisionMm)
  }
  if (want.stars && dots.length > 0) {
    fills.stars = fromPaths64(
      intersection(unionPositive(toPaths64(dots)), engraveRegion),
      precisionMm,
    )
  }

  const outlineCut = notched ?? outlineExact
  const outline = finish(outlineCut)
  const cutOutline = kerfMm > 0 ? finish(offsetPolygon(outlineCut, kerfMm / 2)) : outline
  return {
    faceIndex,
    rotation,
    outline,
    cutOutline,
    ...(holes && { holes }),
    ...(guide && { guide: finish(guide.map((p) => toOutput(t, p))) }),
    lines,
    fills,
  }
}

/** Artwork for every face. */
export function buildAllFaces(
  frames: PolyhedronFrames,
  map: PreparedMap,
  options: ArtworkOptions,
): FaceArtwork[] {
  return frames.faces.map((_, i) => buildFaceArtwork(frames, i, map, options))
}
