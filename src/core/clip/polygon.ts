import { type Vec3, dot, lerp, normalize } from '../vec3'

/**
 * Spherical Sutherland–Hodgman (plan §4.4 step 2): clip a ring of unit vectors against a convex
 * cone through the origin, one great-circle half-space at a time.
 *
 * `ring` is open (no repeated closing point), with segments shorter than 180°. The result is
 * the boundary of (ring interior ∩ cone), as an open ring, possibly empty. Like planar S–H it
 * can contain zero-width "bridge" edges along the cone boundary where a concave ring re-enters;
 * those vanish in the 2D union, which is why this is for fills only (never stroke its output).
 *
 * Exact for the same reason as polyline clipping: arcs and their chords share a plane through
 * the origin, so chord intersections normalise onto the true crossing points.
 */
export function clipRingToCone(ring: readonly Vec3[], planes: readonly Vec3[]): Vec3[] {
  let out: Vec3[] = [...ring]
  for (const n of planes) {
    if (out.length === 0) break
    const input = out
    out = []
    let prev = input[input.length - 1]!
    let dPrev = dot(n, prev)
    for (const cur of input) {
      const dCur = dot(n, cur)
      if (dCur >= 0) {
        if (dPrev < 0) out.push(normalize(lerp(prev, cur, dPrev / (dPrev - dCur))))
        out.push(cur)
      } else if (dPrev >= 0) {
        out.push(normalize(lerp(prev, cur, dPrev / (dPrev - dCur))))
      }
      prev = cur
      dPrev = dCur
    }
  }
  return out.length >= 3 ? out : []
}

/**
 * Signed solid angle of a spherical ring (open, unit vectors): positive when counter-clockwise
 * seen from outside. Exact for rings smaller than a hemisphere (Van Oosterom–Strackee).
 */
export function sphericalRingArea(ring: readonly Vec3[]): number {
  const a = ring[0]
  if (!a || ring.length < 3) return 0
  let total = 0
  for (let i = 1; i + 1 < ring.length; i++) {
    const b = ring[i]!
    const c = ring[i + 1]!
    const triple =
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    total += 2 * Math.atan2(triple, 1 + dot(a, b) + dot(b, c) + dot(c, a))
  }
  return total
}
