import type { FaceFrame } from '../polyhedron/faces'
import { planePoint } from '../polyhedron/faces'
import { type Vec2, type Vec3, dot, normalize } from '../vec3'

/**
 * Gnomonic projection of direction `p` onto a face plane (plan §4.4 step 3):
 *   x = d (p·u)/(p·n),  y = d (p·v)/(p·n)
 * in model units, relative to the face's foot point. Returns null for directions on or behind
 * the plane's horizon (p·n ≤ 0), which have no projection. Callers clip on the sphere first,
 * so in practice p is always well inside the face cone.
 */
export function gnomonic(face: FaceFrame, p: Vec3): Vec2 | null {
  const pn = dot(p, face.normal)
  if (!(pn > 0)) return null
  const k = face.distance / pn
  return [k * dot(p, face.u), k * dot(p, face.v)]
}

/** Inverse gnomonic: plane coordinates → unit direction on the sphere. */
export function inverseGnomonic(face: FaceFrame, xy: Vec2): Vec3 {
  return normalize(planePoint(face, xy))
}
