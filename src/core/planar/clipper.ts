import {
  ClipType,
  Clipper64,
  EndType,
  FillRule,
  JoinType,
  type Paths64,
  difference,
  inflatePaths,
  intersect,
  union,
} from 'clipper2-ts'

import type { Vec2 } from '../vec3'
import { PRECISION_MM, roundPolyline } from './round'

/** Clipper works in integers: mm × 1000 (plan §4.4 step 4). */
export const SCALE = 1000

export const toPaths64 = (rings: readonly (readonly Vec2[])[]): Paths64 =>
  rings.map((r) => r.map(([x, y]) => ({ x: Math.round(x * SCALE), y: Math.round(y * SCALE) })))

/** Back to mm, optionally rounded to the output grid; drops rings that collapse. */
export function fromPaths64(paths: Paths64, precision: number | null = PRECISION_MM): Vec2[][] {
  const out: Vec2[][] = []
  for (const p of paths) {
    let ring: Vec2[] = p.map(({ x, y }): Vec2 => [x / SCALE, y / SCALE])
    if (precision !== null) ring = roundPolyline(ring, precision)
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first && last && ring.length > 1 && first[0] === last[0] && first[1] === last[1]) {
      ring.pop()
    }
    if (ring.length >= 3) out.push(ring)
  }
  return out
}

/**
 * Union of counter-clockwise rings (holes clockwise): winding > 0 is inside. Also removes the
 * zero-width bridges spherical Sutherland–Hodgman can leave.
 */
export const unionPositive = (rings: Paths64): Paths64 => union(rings, FillRule.Positive)

export const subtract = (subject: Paths64, clip: Paths64): Paths64 =>
  difference(subject, clip, FillRule.NonZero)

export const intersection = (subject: Paths64, clip: Paths64): Paths64 =>
  intersect(subject, clip, FillRule.NonZero)

/** Clip open polylines (mm) to a region; returns the pieces inside, in mm (unrounded). */
export function clipPolylines(lines: readonly (readonly Vec2[])[], region: Paths64): Vec2[][] {
  if (lines.length === 0) return []
  const c = new Clipper64()
  c.addOpenSubject(toPaths64(lines))
  c.addClip(region)
  const closed: Paths64 = []
  const open: Paths64 = []
  c.execute(ClipType.Intersection, FillRule.NonZero, closed, open)
  return open
    .map((p) => p.map(({ x, y }): Vec2 => [x / SCALE, y / SCALE]))
    .filter((p) => p.length >= 2)
}

/** Signed area of a ring (positive = counter-clockwise, y up). */
export function ringArea(ring: readonly Vec2[]): number {
  let a = 0
  ring.forEach(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % ring.length]!
    a += x0 * y1 - x1 * y0
  })
  return a / 2
}

/**
 * Offset a CCW panel outline (convex, or with finger joints) outward by `deltaMm` with mitred
 * (sharp) corners, for kerf compensation (plan §6.3). The miter limit allows corners down to ~30°
 * to stay sharp.
 */
export function offsetPolygon(ring: readonly Vec2[], deltaMm: number): Vec2[] {
  const out = inflatePaths(toPaths64([ring]), deltaMm * SCALE, JoinType.Miter, EndType.Polygon, 4)
  const [result] = fromPaths64(out, null)
  if (!result) throw new Error('kerf offset produced no outline')
  // Keep counter-clockwise, starting near the original first vertex for stable output.
  if (ringArea(result) < 0) result.reverse()
  const [fx, fy] = ring[0]!
  let start = 0
  let best = Infinity
  result.forEach(([x, y], i) => {
    const d = (x - fx) ** 2 + (y - fy) ** 2
    if (d < best) {
      best = d
      start = i
    }
  })
  return [...result.slice(start), ...result.slice(0, start)]
}
