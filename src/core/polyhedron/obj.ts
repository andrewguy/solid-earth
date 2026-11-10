import type { Vec3 } from '../vec3'
import { PolyhedronError } from './preprocess'
import type { PolyhedronDef } from './types'

/**
 * Minimal Wavefront OBJ reader (plan §6.1): `v` and `f` lines only. Normals, texture
 * coordinates, groups and materials are ignored. Supports `f a/b/c` syntax and negative
 * (relative) indices. Output is raw; run it through `preprocess`.
 */
export function parseObj(text: string, name: string): PolyhedronDef {
  const vertices: Vec3[] = []
  const faces: number[][] = []
  text.split(/\r?\n/).forEach((raw, lineIndex) => {
    const line = raw.replace(/#.*/, '').trim()
    if (line === '') return
    const [kind, ...args] = line.split(/\s+/)
    const where = `OBJ line ${lineIndex + 1}`
    if (kind === 'v') {
      const xyz = args.slice(0, 3).map(Number)
      if (xyz.length !== 3 || !xyz.every(Number.isFinite)) {
        throw new PolyhedronError(`${where}: expected "v x y z"`)
      }
      vertices.push(xyz as unknown as Vec3)
    } else if (kind === 'f') {
      if (args.length < 3) throw new PolyhedronError(`${where}: a face needs at least 3 vertices`)
      faces.push(
        args.map((token) => {
          const n = Number.parseInt(token.split('/')[0]!, 10)
          if (!Number.isInteger(n) || n === 0) {
            throw new PolyhedronError(`${where}: invalid vertex reference "${token}"`)
          }
          const idx = n > 0 ? n - 1 : vertices.length + n
          if (idx < 0) throw new PolyhedronError(`${where}: vertex reference ${n} is out of range`)
          return idx
        }),
      )
    }
  })
  if (faces.length === 0) throw new PolyhedronError('the OBJ file contains no faces')
  return { name, vertices, faces }
}
