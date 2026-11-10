import type { Vec3 } from '../vec3'

/**
 * Raw polyhedron: vertex positions plus faces as vertex-index loops,
 * CCW when viewed from outside. Same shape as the JSON import format (plan §6.1).
 */
export interface PolyhedronDef {
  readonly name: string
  readonly vertices: readonly Vec3[]
  readonly faces: readonly (readonly number[])[]
}
