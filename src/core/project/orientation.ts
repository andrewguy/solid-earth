import type { FaceFrame } from '../polyhedron/faces'
import { planePoint } from '../polyhedron/faces'
import { type Vec2, type Vec3, add, angle, dot, length, normalize, scale, sub } from '../vec3'
import { gnomonic } from './gnomonic'

/** Within this angle of a pole, "north" at the face centre is ill-defined (plan §3). */
export const POLE_FALLBACK_RAD = (2 * Math.PI) / 180

/** Area centroid of a planar polygon. */
function centroid2D(pts: readonly Vec2[]): Vec2 {
  let a = 0
  let cx = 0
  let cy = 0
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length]!
    const c = x0 * y1 - x1 * y0
    a += c
    cx += (x0 + x1) * c
    cy += (y0 + y1) * c
  })
  return [cx / (3 * a), cy / (3 * a)]
}

/**
 * Rotation (radians, CCW in the face's y-up frame) that orients a panel for export (plan §3):
 * local north at the face centre points up. If a pole is on or very near the face centre,
 * the longest edge goes on the baseline instead.
 *
 * `north` is the geographic north pole in world space, i.e. the globe rotation applied to +z.
 */
export function northUpRotation(face: FaceFrame, north: Vec3): number {
  const c2 = centroid2D(face.vertices2D)
  const c = normalize(planePoint(face, c2))
  const nearPole = Math.min(angle(c, north), angle(c, scale(north, -1) as Vec3)) < POLE_FALLBACK_RAD
  if (!nearPole) {
    const tangent = sub(north, scale(c, dot(north, c)))
    const step = normalize(add(c, scale(tangent, 1e-3 / length(tangent))))
    const p = gnomonic(face, step)
    if (p) return Math.PI / 2 - Math.atan2(p[1] - c2[1], p[0] - c2[0])
  }
  // Longest edge horizontal at the bottom: a CCW outline has its interior on the left, so the
  // bottom edge must run in +x.
  let best = 0
  let bestLen = -1
  face.vertices2D.forEach((p, k) => {
    const q = face.vertices2D[(k + 1) % face.vertices2D.length]!
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len > bestLen + 1e-9) {
      bestLen = len
      best = k
    }
  })
  const p = face.vertices2D[best]!
  const q = face.vertices2D[(best + 1) % face.vertices2D.length]!
  return -Math.atan2(q[1] - p[1], q[0] - p[0])
}

/** Rotate a 2D point by `rad` about the origin. */
export function rotate2D([x, y]: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [c * x - s * y, s * x + c * y]
}
