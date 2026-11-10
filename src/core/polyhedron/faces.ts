import { type Vec2, type Vec3, add, cross, dot, length, normalize, scale, sub } from '../vec3'
import type { PolyhedronDef } from './types'

/**
 * Per-face geometry for projection (plan §4.1 step 6).
 *
 * The in-plane basis (u, v, normal) is right-handed with `normal` pointing outward, so 2D
 * coordinates read as seen from outside the solid (not mirrored). 2D coordinates are relative
 * to the foot point `normal · distance` (the face plane's closest point to the origin), which
 * is where the face-normal direction projects. y is "up" here; SVG export flips it.
 */
export interface FaceFrame {
  readonly index: number
  readonly vertexIndices: readonly number[]
  /** 3D vertex positions, CCW from outside. */
  readonly vertices: readonly Vec3[]
  /** Unit outward plane normal. */
  readonly normal: Vec3
  /** Plane distance from the origin (> 0 when the origin is inside). */
  readonly distance: number
  readonly u: Vec3
  readonly v: Vec3
  /** Vertices in (u, v) plane coordinates. */
  readonly vertices2D: readonly Vec2[]
  /**
   * Unit normals of the planes through the origin and each edge (vertex i → i+1), pointing
   * into the face cone. A direction p is inside the cone iff dot(plane, p) ≥ 0 for all.
   */
  readonly edgePlanes: readonly Vec3[]
}

export interface PolyhedronEdge {
  /** Vertex indices, a < b. */
  readonly a: number
  readonly b: number
  /** The two faces sharing this edge. */
  readonly faces: readonly [number, number]
  /** Interior dihedral angle in radians. */
  readonly dihedral: number
}

export interface PolyhedronFrames {
  readonly def: PolyhedronDef
  readonly faces: readonly FaceFrame[]
  readonly edges: readonly PolyhedronEdge[]
}

/** Newell's method: robust normal for a (near-)planar polygon. Returns a unit vector. */
function newellNormal(pts: readonly Vec3[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0, z0] = pts[i]!
    const [x1, y1, z1] = pts[(i + 1) % pts.length]!
    nx += (y0 - y1) * (z0 + z1)
    ny += (z0 - z1) * (x0 + x1)
    nz += (x0 - x1) * (y0 + y1)
  }
  return normalize([nx, ny, nz])
}

function buildFace(def: PolyhedronDef, index: number): FaceFrame {
  const vertexIndices = def.faces[index]!
  const vertices = vertexIndices.map((i) => {
    const p = def.vertices[i]
    if (!p) throw new Error(`face ${index} references missing vertex ${i}`)
    return p
  })
  if (vertices.length < 3) throw new Error(`face ${index} has fewer than 3 vertices`)

  const normal = newellNormal(vertices)
  const distance = vertices.reduce((s, p) => s + dot(normal, p), 0) / vertices.length
  if (!(distance > 0)) {
    throw new Error(
      `face ${index}: origin is not strictly inside (plane distance ${distance}); ` +
        'faces must be CCW from outside and the solid centred on the origin',
    )
  }

  const u = normalize(sub(vertices[1]!, vertices[0]!))
  const v = cross(normal, u)
  const foot = scale(normal, distance)
  const vertices2D = vertices.map((p): Vec2 => {
    const r = sub(p, foot)
    return [dot(r, u), dot(r, v)]
  })
  const edgePlanes = vertices.map((p, i) =>
    normalize(cross(p, vertices[(i + 1) % vertices.length]!)),
  )

  return { index, vertexIndices, vertices, normal, distance, u, v, vertices2D, edgePlanes }
}

function buildEdges(def: PolyhedronDef, faces: readonly FaceFrame[]): PolyhedronEdge[] {
  const byKey = new Map<string, { a: number; b: number; faces: number[] }>()
  def.faces.forEach((loop, f) => {
    loop.forEach((i, k) => {
      const j = loop[(k + 1) % loop.length]!
      const a = Math.min(i, j)
      const b = Math.max(i, j)
      const key = `${a}-${b}`
      const entry = byKey.get(key) ?? { a, b, faces: [] }
      entry.faces.push(f)
      byKey.set(key, entry)
    })
  })
  return [...byKey.values()].map(({ a, b, faces: fs }) => {
    if (fs.length !== 2) {
      throw new Error(`edge ${a}-${b} is shared by ${fs.length} faces (expected 2)`)
    }
    const [f0, f1] = fs as [number, number]
    const n0 = faces[f0]!.normal
    const n1 = faces[f1]!.normal
    const between = Math.atan2(length(cross(n0, n1)), dot(n0, n1))
    return { a, b, faces: [f0, f1] as const, dihedral: Math.PI - between }
  })
}

export function buildFrames(def: PolyhedronDef): PolyhedronFrames {
  const faces = def.faces.map((_, i) => buildFace(def, i))
  return { def, faces, edges: buildEdges(def, faces) }
}

/** The 3D point on a face plane at plane coordinates `xy`. */
export function planePoint(face: FaceFrame, [x, y]: Vec2): Vec3 {
  return add(add(scale(face.normal, face.distance), scale(face.u, x)), scale(face.v, y))
}
