import { PanelError, edgeInset, faceEdges, insetPolygon, panelOutline } from './panel'
import type { FaceFrame, PolyhedronEdge, PolyhedronFrames } from './polyhedron/faces'
import { type Vec2, type Vec3, add, cross, distance, dot, normalize, scale, sub } from './vec3'

/**
 * Finger joints (plan §12). All geometry here is in model units.
 *
 * Cross-section conventions, the same for both panels of an edge by symmetry: positions are
 * measured in the panel's face plane, perpendicular to the edge, inward from the true edge
 * (negative = beyond it); depth is measured from the outer surface into the material.
 */

export type FingerTip = 'fill' | 'flush'

/** User-facing finger settings, in mm. */
export interface FingerOptions {
  /** Width of every finger and slot along the edge. */
  readonly widthMm: number
  readonly tip: FingerTip
  /** Per side, along the edge and in notch depth. Negative for a press fit. */
  readonly clearanceMm: number
}

export type JointOptions = { readonly kind: 'butt' } | ({ readonly kind: 'finger' } & FingerOptions)

export const BUTT: JointOptions = { kind: 'butt' }

/** Extra plain length at each end of a fingered edge, beyond the computed clearance. */
export const CORNER_MARGIN_MM = 0.5

/** Finger settings converted to model units. */
export interface FingerParams {
  readonly thickness: number
  readonly width: number
  readonly clearance: number
  readonly margin: number
  readonly tip: FingerTip
}

export function fingerParams(
  options: FingerOptions,
  thicknessMm: number,
  mmPerUnit: number,
): FingerParams {
  return {
    thickness: thicknessMm / mmPerUnit,
    width: options.widthMm / mmPerUnit,
    clearance: options.clearanceMm / mmPerUnit,
    margin: CORNER_MARGIN_MM / mmPerUnit,
    tip: options.tip,
  }
}

/** One edge's finger joint in cross-section (positions as in the module comment). */
export interface FingerProfile {
  /** Square-cut butt inset, used for the plain stretches at the edge ends. */
  readonly butt: number
  /** Where a finger's end face is. */
  readonly tip: number
  /** Where a slot's end face is (clearance included). */
  readonly notch: number
  /**
   * The band of the face plane, perpendicular to the edge, that this joint can affect: the
   * finger, the notch and the whole region where the two panels' slabs overlap. Used to keep
   * fingers clear of other joints at the corners.
   */
  readonly zoneMin: number
  readonly zoneMax: number
}

/**
 * Smallest notch depth in panel B that clears panel A's finger (tip at `tip`), found by the
 * separating-axis test on the two cross-sections. A's finger is {s ≥ tip, 0 ≤ z ≤ t} and B's
 * body {s' ≥ n, 0 ≤ z' ≤ t}, where s' = s·cos θ + z·sin θ and z' = s·sin θ − z·cos θ. Each axis
 * that can separate them gives a lower bound on n; the smallest of those is enough.
 */
function notchDepth(c: number, s: number, t: number, tip: number): number {
  // A's inner face: B's body lies entirely beyond it.
  const bounds = [(t + Math.max(0, t * c)) / s]
  // A's finger end face: B's body lies entirely beyond it (only possible when obtuse).
  if (c < 0) bounds.push((t * s - tip) / -c)
  // B's notch face: A's finger lies entirely before it.
  if (c <= 0) bounds.push(tip * c + t * s)
  return Math.min(...bounds)
}

/**
 * Finger-joint cross-section for an edge with interior dihedral `dihedral` (radians).
 *
 * - Fill: the finger reaches right through the neighbour's slab. Its end face is at or beyond
 *   the neighbour's outer plane, so the outer surface is closed once the protruding tips are
 *   sanded flush.
 * - Flush: nothing crosses the neighbour's outer plane; small wedge gaps open at the surface.
 *
 * At 90° both are an ordinary box joint (tip 0, notch t).
 */
export function fingerProfile(
  dihedral: number,
  thickness: number,
  tip: FingerTip,
  clearance: number,
): FingerProfile {
  const t = thickness
  const c = Math.cos(dihedral)
  const s = Math.sin(dihedral)
  const cot = c / s
  const tipPos = tip === 'fill' ? Math.min(0, t * cot) : Math.max(0, t * cot)
  const notch = notchDepth(c, s, t, tipPos) + clearance
  const butt = edgeInset(dihedral, t)
  // The slabs overlap over positions min(0, t·cot θ) … t/sin θ (obtuse) or t·(1 + cos θ)/sin θ.
  const overlapMax = c < 0 ? t / s : (t * (1 + c)) / s
  return {
    butt,
    tip: tipPos,
    notch,
    zoneMin: Math.min(0, t * cot),
    zoneMax: Math.max(overlapMax, notch, butt),
  }
}

/** Finger layout of one edge, measured along it from vertex `edge.a` (a < b). */
export interface EdgeFingers {
  readonly length: number
  /** Start of the first segment. */
  readonly start: number
  readonly width: number
  /** Number of segments (even); 0 = plain butt joint. */
  readonly count: number
}

interface Topology {
  readonly vertexFaces: readonly (readonly number[])[]
  readonly edgeByKey: ReadonlyMap<string, PolyhedronEdge>
}

const topologies = new WeakMap<PolyhedronFrames, Topology>()
const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

function topology(frames: PolyhedronFrames): Topology {
  let topo = topologies.get(frames)
  if (!topo) {
    const vertexFaces: number[][] = frames.def.vertices.map(() => [])
    for (const f of frames.faces) for (const v of f.vertexIndices) vertexFaces[v]!.push(f.index)
    topo = { vertexFaces, edgeByKey: new Map(frames.edges.map((e) => [`${e.a}-${e.b}`, e])) }
    topologies.set(frames, topo)
  }
  return topo
}

/** In-plane unit vector perpendicular to edge p→q (in the face's loop order), into the face. */
const inwardOf = (face: FaceFrame, p: Vec3, q: Vec3) => cross(face.normal, normalize(sub(q, p)))

/** The face's two loop edges at vertex v, as [previous vertex, next vertex] in loop order. */
function neighboursAt(face: FaceFrame, v: number): [number, number] {
  const loop = face.vertexIndices
  const j = loop.indexOf(v)
  return [loop[(j + loop.length - 1) % loop.length]!, loop[(j + 1) % loop.length]!]
}

/**
 * How far from vertex `v` along `edge` fingers must stop so that this joint's zone never meets
 * another joint's zone or another panel's slab (plan §12.4 item 3). Conservative: it tests
 * - in each of the edge's two face planes, the zone band against the band of the face's other
 *   edge at v, and
 * - the zone's cross-section corners against the full slab of every other face at v.
 */
function cornerClearance(
  frames: PolyhedronFrames,
  edge: PolyhedronEdge,
  v: number,
  p: FingerParams,
): number {
  const { vertexFaces, edgeByKey } = topology(frames)
  const verts = frames.def.vertices
  const other = v === edge.a ? edge.b : edge.a
  const origin = verts[v]!
  const dir = normalize(sub(verts[other]!, origin))
  const t = p.thickness
  const prof = fingerProfile(edge.dihedral, t, p.tip, p.clearance)
  const zone = [prof.zoneMin, prof.zoneMax]
  let need = 0
  const corners: Vec3[] = []
  for (const f of edge.faces) {
    const face = frames.faces[f]!
    const [prev, next] = neighboursAt(face, v)
    // This edge's inward direction, using its loop order in this face.
    const inward =
      next === other ? inwardOf(face, origin, verts[other]!) : inwardOf(face, verts[other]!, origin)
    // The face's other edge at v and its band.
    const adjVertex = next === other ? prev : next
    const adjInward =
      next === other
        ? inwardOf(face, verts[adjVertex]!, origin)
        : inwardOf(face, origin, verts[adjVertex]!)
    const adjEdge = edgeByKey.get(edgeKey(v, adjVertex))!
    const adjMax = fingerProfile(adjEdge.dihedral, t, p.tip, p.clearance).zoneMax
    const a = dot(adjInward, dir) // > 0 on a convex face
    const b = dot(adjInward, inward)
    for (const w of zone) need = Math.max(need, (adjMax - w * b) / a)
    for (const w of zone) {
      for (const h of [0, t])
        corners.push(add(origin, sub(scale(inward, w), scale(face.normal, h))))
    }
  }
  for (const x of vertexFaces[v]!) {
    if (x === edge.faces[0] || x === edge.faces[1]) continue
    const face = frames.faces[x]!
    const rate = -dot(face.normal, dir) // > 0: the edge runs away from this face's plane
    for (const q of corners) {
      const depth = face.distance - dot(face.normal, q)
      need = Math.max(need, (t - depth) / rate)
    }
  }
  return need + p.margin + Math.abs(p.clearance)
}

/**
 * Finger layout for one edge (plan §12.2): fixed-width segments, an even number of them, with
 * the leftover length split equally between the ends after the corner clearances. Computed from
 * the edge alone, so both panels get bit-identical layouts.
 */
export function edgeFingers(
  frames: PolyhedronFrames,
  edge: PolyhedronEdge,
  p: FingerParams,
): EdgeFingers {
  const verts = frames.def.vertices
  const length = distance(verts[edge.a]!, verts[edge.b]!)
  const ea = cornerClearance(frames, edge, edge.a, p)
  const eb = cornerClearance(frames, edge, edge.b, p)
  const usable = length - ea - eb
  const count = usable > 0 ? 2 * Math.floor(usable / (2 * p.width)) : 0
  const start = ea + (usable - count * p.width) / 2
  return { length, start, width: p.width, count }
}

/** Finger layouts of one face's edges, in loop order (edge k runs from vertex k to k+1). */
export function faceFingers(
  frames: PolyhedronFrames,
  faceIndex: number,
  p: FingerParams,
): EdgeFingers[] {
  const { edgeByKey } = topology(frames)
  const loop = frames.faces[faceIndex]!.vertexIndices
  return loop.map((a, k) =>
    edgeFingers(frames, edgeByKey.get(edgeKey(a, loop[(k + 1) % loop.length]!))!, p),
  )
}

/**
 * The panel as cut (before kerf), with finger joints, in the face's (u, v) frame. Plain
 * stretches and edges without fingers follow the square-cut butt inset. Each panel takes the
 * even-numbered segments of each edge counting along its own loop direction, which interlocks
 * with the neighbour because every edge has an even number of segments.
 */
export function fingeredOutline(
  frames: PolyhedronFrames,
  faceIndex: number,
  p: FingerParams,
): Vec2[] {
  const face = frames.faces[faceIndex]!
  const loop = face.vertexIndices
  const corners = panelOutline(frames, faceIndex, p.thickness)
  const edges = faceEdges(frames, faceIndex)
  const layouts = faceFingers(frames, faceIndex, p)
  const out: Vec2[] = []
  const push = (pt: Vec2) => {
    const last = out[out.length - 1]
    if (!last || last[0] !== pt[0] || last[1] !== pt[1]) out.push(pt)
  }
  loop.forEach((a, k) => {
    push(corners[k]!)
    const lay = layouts[k]!
    if (lay.count === 0) return
    const prof = fingerProfile(edges[k]!.dihedral, p.thickness, p.tip, p.clearance)
    const p0 = face.vertices2D[k]!
    const p1 = face.vertices2D[(k + 1) % loop.length]!
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const e: Vec2 = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len]
    const n: Vec2 = [-e[1], e[0]]
    const at = (u: number, w: number): Vec2 => [
      p0[0] + u * e[0] + w * n[0],
      p0[1] + u * e[1] + w * n[1],
    ]
    const forward = a < loop[(k + 1) % loop.length]!
    const cl = p.clearance
    for (let i = 0; i < lay.count; i++) {
      // Segment i in this panel's direction; positions measured from this panel's vertex k.
      const j = forward ? i : lay.count - 1 - i
      const lo = lay.start + j * lay.width
      const hi = lo + lay.width
      const [u0, u1] = forward ? [lo, hi] : [lay.length - hi, lay.length - lo]
      const owned = i % 2 === 0
      const depth = owned ? prof.tip : prof.notch
      // Fingers shrink by the clearance at each side; slots grow by the same amount.
      const d = owned ? cl : -cl
      if (i === 0) push(at(u0 + d, prof.butt))
      push(at(u0 + d, depth))
      push(at(u1 - d, depth))
      if (i === lay.count - 1) push(at(u1 - d, prof.butt))
    }
  })
  return out
}

/**
 * A convex polygon inside every part of the fingered panel's outer surface: the face inset on
 * each edge by the deepest of its butt inset, finger tip and notch. Map lines entirely inside it
 * need no 2D clipping. Null if the inset leaves nothing.
 */
export function fingerSafeInterior(
  frames: PolyhedronFrames,
  faceIndex: number,
  p: FingerParams,
): Vec2[] | null {
  const insets = faceEdges(frames, faceIndex).map((e) => {
    const prof = fingerProfile(e.dihedral, p.thickness, p.tip, p.clearance)
    return Math.max(prof.butt, prof.tip, prof.notch)
  })
  try {
    return insetPolygon(frames.faces[faceIndex]!.vertices2D, insets)
  } catch (err) {
    if (err instanceof PanelError) return null
    throw err
  }
}
