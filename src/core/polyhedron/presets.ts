import type { Vec3 } from '../vec3'
import { convexHullFaces } from './hull'
import type { PolyhedronDef } from './types'

const PHI = (1 + Math.sqrt(5)) / 2

/** All cyclic permutations (x, y, z) → (y, z, x) → (z, x, y). */
const cyclic = ([x, y, z]: Vec3): Vec3[] => [
  [x, y, z],
  [y, z, x],
  [z, x, y],
]

/** Every sign combination of the non-zero components. */
function signs([x, y, z]: Vec3): Vec3[] {
  const out: Vec3[] = []
  for (const sx of x === 0 ? [1] : [1, -1])
    for (const sy of y === 0 ? [1] : [1, -1])
      for (const sz of z === 0 ? [1] : [1, -1]) out.push([sx * x, sy * y, sz * z])
  return out
}

/** Regular icosahedron with edge length 1, centred on the origin. */
export function icosahedron(): PolyhedronDef {
  // (0, ±1, ±φ) and cyclic permutations: edge length 2, so halve.
  const vertices = cyclic([0, 1, PHI])
    .flatMap(signs)
    .map(([x, y, z]): Vec3 => [x / 2, y / 2, z / 2])
  return { name: 'icosahedron', vertices, faces: convexHullFaces(vertices) }
}
