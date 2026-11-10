import { type Vec3, dot, lerp, normalize } from '../vec3'

/**
 * Clip a polyline on the unit sphere against a convex cone through the origin
 * (plan §4.4 step 2).
 *
 * Each segment is the great-circle arc between consecutive points (assumed shorter than
 * 180°). An arc and its chord lie in the same plane through the origin, so clipping the chord
 * against each half-space dot(plane, p) ≥ 0 and normalising the cut points is exact. The
 * constraints are linear in the chord parameter, so this is Liang–Barsky in 3D.
 *
 * Output pieces are unit vectors. Points inside the cone are passed through unchanged (same
 * object), and new points are added only where the polyline crosses a cone boundary.
 * A closed input (first point === last point, by value) is rejoined across its start if both
 * ends are inside.
 *
 * Tolerance: `epsilon` defaults to 0 on purpose. Adjacent faces' edge planes are exact
 * negations of each other (cross(b, a) = −cross(a, b) bit for bit), so with ε = 0 the
 * inside/outside tests are exactly complementary and both faces compute bit-identical cut
 * points on a shared edge. Any ε > 0 creates a band where one face cuts and the other does not.
 * Points exactly on a boundary (dot = 0) count as inside both faces, so a segment lying exactly
 * along a shared edge appears on both panels.
 */
export function clipPolylineToCone(
  points: readonly Vec3[],
  planes: readonly Vec3[],
  epsilon = 0,
): Vec3[][] {
  const runs: Vec3[][] = []
  let current: Vec3[] | null = null
  let firstRunStartsAtStart = false

  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const interval = clipSegment(a, b, planes, epsilon)
    if (!interval) {
      if (current) runs.push(current)
      current = null
      continue
    }
    const [t0, t1] = interval
    const p0 = t0 === 0 ? a : normalize(lerp(a, b, t0))
    const p1 = t1 === 1 ? b : normalize(lerp(a, b, t1))
    if (current && t0 === 0) {
      current.push(p1)
    } else {
      if (current) runs.push(current)
      current = [p0, p1]
      if (i === 0 && t0 === 0) firstRunStartsAtStart = true
    }
    if (t1 !== 1) {
      runs.push(current)
      current = null
    }
  }
  if (current) runs.push(current)

  // Rejoin a closed ring that was split at its (arbitrary) start point.
  const first = points[0]
  const last = points[points.length - 1]
  const closed = first && last && points.length > 2 && sameVec(first, last)
  if (closed && runs.length > 1 && firstRunStartsAtStart && current) {
    const head = runs.shift()!
    const tail = runs.pop()!
    runs.push([...tail, ...head.slice(1)])
  }
  return runs
}

/**
 * Parametric interval [t0, t1] ⊆ [0, 1] of the chord a→b inside all half-spaces, or null.
 * Degenerate intervals (touching a boundary at a single point) count as outside.
 */
function clipSegment(
  a: Vec3,
  b: Vec3,
  planes: readonly Vec3[],
  epsilon: number,
): [number, number] | null {
  let t0 = 0
  let t1 = 1
  for (const n of planes) {
    const da = dot(n, a)
    const db = dot(n, b)
    const aIn = da >= -epsilon
    const bIn = db >= -epsilon
    if (aIn && bIn) continue
    if (!aIn && !bIn) return null
    const t = da / (da - db)
    if (aIn) t1 = Math.min(t1, t)
    else t0 = Math.max(t0, t)
    if (t1 - t0 <= 0) return null
  }
  return [t0, t1]
}

const sameVec = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
