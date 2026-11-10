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

/**
 * Where direction `p` meets the surface of a convex solid: scaled out along its ray to the
 * first face plane it reaches, i.e. by 1 / max(p·n / d). Equals `planePoint(face,
 * gnomonic(face, p))` for the face whose cone contains p. The live GPU preview's vertex shader
 * (ui/three/LiveLines.tsx) implements exactly this.
 */
export function surfacePoint(faces: readonly FaceFrame[], p: Vec3): Vec3 {
  let m = 0
  for (const f of faces) m = Math.max(m, dot(p, f.normal) / f.distance)
  return [p[0] / m, p[1] / m, p[2] / m]
}
