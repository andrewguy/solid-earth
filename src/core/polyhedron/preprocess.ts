import { type Vec3, angle, cross, dot, length, normalize, sub } from '../vec3'
import type { PolyhedronDef } from './types'

/** A user-facing problem with a polyhedron definition. Messages are shown verbatim in the UI. */
export class PolyhedronError extends Error {
  override name = 'PolyhedronError'
}

/** Relative to the bounding-box diagonal (plan §4.1). */
const WELD_TOL = 1e-6
/** Planarity and convexity slack, relative to the diagonal. Must exceed what merging allows. */
const PLANE_TOL = 2e-4
/** Adjacent faces whose normals differ by less than this are merged (plan §4.1). */
const MERGE_ANGLE = (0.01 * Math.PI) / 180
/** Vertices whose neighbours turn by less than this are collinear. */
const COLLINEAR_ANGLE = 1e-6

type Face = number[]

const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Newell normal (unnormalised; length = 2 × area). */
function newell(vs: readonly Vec3[], face: readonly number[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < face.length; i++) {
    const [x0, y0, z0] = vs[face[i]!]!
    const [x1, y1, z1] = vs[face[(i + 1) % face.length]!]!
    x += (y0 - y1) * (z0 + z1)
    y += (z0 - z1) * (x0 + x1)
    z += (x0 - x1) * (y0 + y1)
  }
  return [x, y, z]
}

function centroidOf(vs: readonly Vec3[], idx: Iterable<number>): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  let n = 0
  for (const i of idx) {
    const p = vs[i]!
    x += p[0]
    y += p[1]
    z += p[2]
    n++
  }
  return [x / n, y / n, z / n]
}

function checkInput(def: PolyhedronDef): void {
  if (def.vertices.length < 4) throw new PolyhedronError('needs at least 4 vertices')
  if (def.faces.length < 4) throw new PolyhedronError('needs at least 4 faces')
  def.vertices.forEach((v, i) => {
    if (v.length !== 3 || !v.every(Number.isFinite)) {
      throw new PolyhedronError(`vertex ${i} is not three finite numbers`)
    }
  })
  def.faces.forEach((f, i) => {
    if (f.length < 3) throw new PolyhedronError(`face ${i} has fewer than 3 vertices`)
    for (const v of f) {
      if (!Number.isInteger(v) || v < 0 || v >= def.vertices.length) {
        throw new PolyhedronError(`face ${i} references vertex ${v}, which does not exist`)
      }
    }
  })
}

/** Merge vertices closer than `tol`, via a uniform grid. Returns old index → new index. */
function weld(vs: readonly Vec3[], tol: number): { vertices: Vec3[]; map: number[] } {
  const cell = (x: number) => Math.floor(x / tol)
  const grid = new Map<string, number[]>()
  const vertices: Vec3[] = []
  const map = vs.map((p) => {
    const [cx, cy, cz] = [cell(p[0]), cell(p[1]), cell(p[2])]
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (length(sub(vertices[j]!, p)) <= tol) return j
          }
        }
    const j = vertices.push(p) - 1
    const key = `${cx},${cy},${cz}`
    grid.set(key, [...(grid.get(key) ?? []), j])
    return j
  })
  return { vertices, map }
}

/** Remove repeated consecutive indices (cyclically). */
function dedupeLoop(face: readonly number[]): Face {
  const out = face.filter((v, i) => v !== face[(i + face.length - 1) % face.length])
  return out.length === 0 ? [face[0]!] : out
}

/** Union–find over face indices. */
function makeUnion(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  return {
    find,
    union: (a: number, b: number) => {
      const [ra, rb] = [find(a), find(b)]
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
    },
  }
}

/** Merge groups of adjacent, coplanar, consistently wound faces into single polygons. */
function mergeCoplanar(vs: readonly Vec3[], faces: readonly Face[]): Face[] {
  const normals = faces.map((f) => normalize(newell(vs, f)))
  const edgeFaces = new Map<string, number[]>()
  faces.forEach((f, fi) =>
    f.forEach((a, k) => {
      const key = edgeKey(a, f[(k + 1) % f.length]!)
      edgeFaces.set(key, [...(edgeFaces.get(key) ?? []), fi])
    }),
  )
  const uf = makeUnion(faces.length)
  for (const fs of edgeFaces.values()) {
    if (fs.length === 2 && angle(normals[fs[0]!]!, normals[fs[1]!]!) < MERGE_ANGLE) {
      uf.union(fs[0]!, fs[1]!)
    }
  }

  const groups = new Map<number, number[]>()
  faces.forEach((_, fi) => {
    const root = uf.find(fi)
    groups.set(root, [...(groups.get(root) ?? []), fi])
  })

  const out: Face[] = []
  for (const members of groups.values()) {
    if (members.length === 1) {
      out.push(faces[members[0]!]!)
      continue
    }
    // Boundary = directed edges whose reverse is not inside the group; chain them into a loop.
    const directed = new Set<string>()
    for (const fi of members) {
      const f = faces[fi]!
      f.forEach((a, k) => directed.add(`${a}>${f[(k + 1) % f.length]}`))
    }
    const next = new Map<number, number>()
    for (const e of directed) {
      const [a, b] = e.split('>').map(Number) as [number, number]
      if (directed.has(`${b}>${a}`)) continue
      if (next.has(a)) {
        throw new PolyhedronError(
          `faces ${members.join(', ')} are coplanar but do not form a simple polygon ` +
            `(vertex ${a} is pinched)`,
        )
      }
      next.set(a, b)
    }
    const start = Math.min(...next.keys())
    const loop: Face = [start]
    for (let v = next.get(start)!; v !== start; v = next.get(v)!) {
      if (v === undefined || loop.length > next.size) {
        throw new PolyhedronError(
          `faces ${members.join(', ')} are coplanar but have an open boundary`,
        )
      }
      loop.push(v)
    }
    if (loop.length !== next.size) {
      throw new PolyhedronError(
        `faces ${members.join(', ')} are coplanar but enclose a hole (boundary is not one loop)`,
      )
    }
    out.push(loop)
  }
  return out
}

/** Drop vertices that sit on a straight edge in every face that uses them. */
function removeCollinear(vs: readonly Vec3[], faces: readonly Face[]): Face[] {
  const collinearIn = (f: Face, k: number) => {
    const p = vs[f[(k + f.length - 1) % f.length]!]!
    const v = vs[f[k]!]!
    const n = vs[f[(k + 1) % f.length]!]!
    return angle(sub(v, p), sub(n, v)) < COLLINEAR_ANGLE
  }
  const removable = new Map<number, boolean>()
  for (const f of faces) {
    f.forEach((v, k) => removable.set(v, (removable.get(v) ?? true) && collinearIn(f, k)))
  }
  return faces.map((f) => f.filter((v) => !removable.get(v)))
}

/** Every edge must belong to exactly two faces (closed 2-manifold). */
function checkEdgeCounts(faces: readonly Face[]): Map<string, number[]> {
  const edgeFaces = new Map<string, number[]>()
  faces.forEach((f, fi) =>
    f.forEach((a, k) => {
      const key = edgeKey(a, f[(k + 1) % f.length]!)
      edgeFaces.set(key, [...(edgeFaces.get(key) ?? []), fi])
    }),
  )
  for (const [key, fs] of edgeFaces) {
    const [a, b] = key.split('-')
    if (fs.length === 1) {
      throw new PolyhedronError(
        `not closed: edge ${a}–${b} belongs only to face ${fs[0]} (the surface has a hole)`,
      )
    }
    if (fs.length > 2) {
      throw new PolyhedronError(`not manifold: edge ${a}–${b} is shared by faces ${fs.join(', ')}`)
    }
  }
  return edgeFaces
}

/** Neighbouring faces must traverse their shared edge in opposite directions. */
function checkWinding(faces: readonly Face[]): void {
  const directed = new Map<string, number>()
  faces.forEach((f, fi) =>
    f.forEach((a, k) => {
      const d = `${a}>${f[(k + 1) % f.length]}`
      const other = directed.get(d)
      if (other !== undefined) {
        throw new PolyhedronError(`faces ${other} and ${fi} are wound inconsistently`)
      }
      directed.set(d, fi)
    }),
  )
}

/**
 * Orient all faces consistently by walking across shared edges, then flip everything if the
 * enclosed signed volume is negative, so faces end up CCW from outside (plan §4.1 step 4).
 * Works for any closed orientable surface, so a non-convex input still reaches the convexity
 * check and gets the right error message.
 */
function orientOutward(vs: readonly Vec3[], faces: readonly Face[]): Face[] {
  const edgeFaces = checkEdgeCounts(faces)
  const out: (Face | null)[] = faces.map(() => null)
  const has = (f: Face, a: number, b: number) =>
    f.some((v, k) => v === a && f[(k + 1) % f.length] === b)

  out[0] = [...faces[0]!]
  const queue = [0]
  while (queue.length > 0) {
    const fi = queue.shift()!
    const f = out[fi]!
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length]!
      for (const gi of edgeFaces.get(edgeKey(a, b))!) {
        if (gi === fi) continue
        // The neighbour must run b→a; if it runs a→b it needs flipping.
        const g = out[gi] ?? faces[gi]!
        const flip = has(g, a, b)
        if (out[gi]) {
          if (flip) throw new PolyhedronError('the surface is not orientable')
          continue
        }
        out[gi] = flip ? [...g].reverse() : [...g]
        queue.push(gi)
      }
    })
  }
  const missing = out.findIndex((f) => f === null)
  if (missing >= 0) {
    throw new PolyhedronError(`the shape has separate pieces (face ${missing} is not connected)`)
  }

  const oriented = out as Face[]
  let volume = 0
  for (const f of oriented) {
    const p0 = vs[f[0]!]!
    for (let k = 1; k + 1 < f.length; k++) volume += dot(p0, cross(vs[f[k]!]!, vs[f[k + 1]!]!))
  }
  return volume >= 0 ? oriented : oriented.map((f) => [...f].reverse())
}

/**
 * Normalise a raw polyhedron (plan §4.1): weld, drop degenerate faces, orient outward, merge
 * coplanar neighbours, remove collinear vertices, validate (closed 2-manifold, planar, convex),
 * then centre the vertex centroid on the origin.
 *
 * Throws `PolyhedronError` with a readable message for anything it cannot use.
 * Face order follows the input (a merged face takes its first member's position), so face
 * numbers stay predictable.
 */
export function preprocess(input: PolyhedronDef): PolyhedronDef {
  checkInput(input)
  const lo = [0, 1, 2].map((k) => Math.min(...input.vertices.map((v) => v[k]!)))
  const hi = [0, 1, 2].map((k) => Math.max(...input.vertices.map((v) => v[k]!)))
  const diag = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!)
  if (!(diag > 0)) throw new PolyhedronError('all vertices are at the same point')

  // 1. Weld.
  const welded = weld(input.vertices, WELD_TOL * diag)
  let vs = welded.vertices

  // 2. Remap, drop repeated indices and zero-area faces.
  let faces: Face[] = input.faces
    .map((f) => dedupeLoop(f.map((i) => welded.map[i]!)))
    .filter((f) => f.length >= 3 && length(newell(vs, f)) > 1e-12 * diag * diag)

  // 3. Check it is a closed 2-manifold, and orient faces CCW from outside.
  faces = orientOutward(vs, faces)

  // 4–5. Merge coplanar neighbours, then strip collinear vertices.
  faces = removeCollinear(vs, mergeCoplanar(vs, faces))

  // 6. Drop unused vertices and reindex in first-use order.
  const remap = new Map<number, number>()
  for (const f of faces) for (const v of f) if (!remap.has(v)) remap.set(v, remap.size)
  const used: Vec3[] = []
  for (const [oldIdx, newIdx] of remap) used[newIdx] = vs[oldIdx]!
  vs = used
  faces = faces.map((f) => f.map((v) => remap.get(v)!))

  // 7. Validate.
  checkEdgeCounts(faces)
  checkWinding(faces)
  const planeTol = PLANE_TOL * diag
  const pct = (d: number) => `${((100 * d) / diag).toFixed(2)}% of the model size`
  const planes = faces.map((f, fi) => {
    const n = normalize(newell(vs, f))
    const d = f.reduce((s, v) => s + dot(n, vs[v]!), 0) / f.length
    for (const v of f) {
      const off = Math.abs(dot(n, vs[v]!) - d)
      if (off > planeTol) {
        throw new PolyhedronError(
          `face ${fi} is not flat: vertex ${v} is ${pct(off)} off its plane`,
        )
      }
    }
    return { n, d }
  })
  planes.forEach(({ n, d }, fi) => {
    vs.forEach((p, vi) => {
      const out = dot(n, p) - d
      if (out > planeTol) {
        throw new PolyhedronError(
          `not convex: vertex ${vi} is ${pct(out)} outside the plane of face ${fi} ` +
            '(only convex shapes are supported)',
        )
      }
    })
  })

  // 8. Centre on the vertex centroid; the origin must then be strictly inside every face.
  const c = centroidOf(vs, vs.keys())
  vs = vs.map((p) => sub(p, c))
  planes.forEach(({ n, d }, fi) => {
    if (d - dot(n, c) < 1e-6 * diag) {
      throw new PolyhedronError(`face ${fi} passes through the centre: the shape is flat`)
    }
  })

  return { name: input.name, vertices: vs, faces }
}
