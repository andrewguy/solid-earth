import type { Vec3 } from '../vec3'
import { PolyhedronError } from './preprocess'
import type { PolyhedronDef } from './types'

/**
 * Parse the JSON polyhedron format (plan §6.1):
 *   { "vertices": [[x, y, z], …], "faces": [[i, j, k, …], …], "name"?: string }
 * Indices are 0-based. Output is raw; run it through `preprocess`.
 */
export function parsePolyhedronJson(text: string, fallbackName: string): PolyhedronDef {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new PolyhedronError(`not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof data !== 'object' || data === null) {
    throw new PolyhedronError('expected an object with "vertices" and "faces"')
  }
  const { vertices, faces, name } = data as Record<string, unknown>
  if (!Array.isArray(vertices)) throw new PolyhedronError('"vertices" must be an array')
  if (!Array.isArray(faces)) throw new PolyhedronError('"faces" must be an array')

  const vs = vertices.map((v, i): Vec3 => {
    const [x, y, z] = Array.isArray(v) && v.length === 3 ? (v as unknown[]) : []
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      throw new PolyhedronError(`vertices[${i}] must be [x, y, z]`)
    }
    return [x, y, z]
  })
  const fs = faces.map((f, i) => {
    if (!Array.isArray(f) || !f.every((c) => Number.isInteger(c) && c >= 0)) {
      throw new PolyhedronError(`faces[${i}] must be an array of vertex indices (0-based)`)
    }
    return f as number[]
  })
  return {
    name: typeof name === 'string' && name.trim() ? name : fallbackName,
    vertices: vs,
    faces: fs,
  }
}
