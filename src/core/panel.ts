import { type FaceFrame, type PolyhedronFrames, planePoint } from './polyhedron/faces'
import { type Vec2, type Vec3, cross, normalize } from './vec3'

const DEG = 180 / Math.PI

/**
 * Square-cut butt joint (plan §3). Each panel's outer face lies on its face plane and its edges
 * are cut perpendicular to it. On a convex solid, two such panels cut at the true face size would
 * overlap at the inner corner, so every edge is pulled in until the two inner corners meet on the
 * plane bisecting the dihedral angle.
 *
 * With dihedral θ and thickness t, and V = 180° − θ:
 * - inset of each panel edge, measured in the face plane: t·tan(V/2)
 * - a V-groove of angle V opens on the outside, 2·t·sin(V/2) wide at the outer surface.
 */
export function vGap(dihedralRad: number, thicknessMm: number) {
  const v = Math.PI - dihedralRad
  return {
    angleDeg: v * DEG,
    insetMm: edgeInset(dihedralRad, thicknessMm),
    grooveMm: 2 * thicknessMm * Math.sin(v / 2),
  }
}

/**
 * Sanded bevel (plan §14.1): the bevel lies on the plane bisecting the dihedral, so it is tilted
 * from square by V/2 = 90° − θ/2. Its width on the back face is the butt inset.
 */
export function bevelTiltDeg(dihedralRad: number): number {
  return ((Math.PI - dihedralRad) / 2) * DEG
}

/** How far a square-cut edge is pulled in from the true edge: t·tan(V/2) = t / tan(θ/2). */
export function edgeInset(dihedralRad: number, thickness: number): number {
  return thickness / Math.tan(dihedralRad / 2)
}

export interface DihedralGroup {
  readonly dihedralDeg: number
  readonly vGapDeg: number
  readonly insetMm: number
  /** Width of the outer V-groove at the surface. */
  readonly grooveMm: number
  readonly edgeCount: number
}

/** Edges grouped by dihedral angle (to 0.01°), most common first. */
export function dihedralGroups(frames: PolyhedronFrames, thicknessMm: number): DihedralGroup[] {
  const groups = new Map<string, { dihedral: number; count: number }>()
  for (const e of frames.edges) {
    const key = (e.dihedral * DEG).toFixed(2)
    const g = groups.get(key) ?? { dihedral: e.dihedral, count: 0 }
    g.count++
    groups.set(key, g)
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.dihedral - a.dihedral)
    .map(({ dihedral, count }) => {
      const gap = vGap(dihedral, thicknessMm)
      return {
        dihedralDeg: dihedral * DEG,
        vGapDeg: gap.angleDeg,
        insetMm: gap.insetMm,
        grooveMm: gap.grooveMm,
        edgeCount: count,
      }
    })
}

export interface FaceEdgeInfo {
  /** Position in the face's vertex loop: edge k runs from vertex k to vertex k+1. */
  readonly k: number
  readonly neighbour: number
  /** Interior dihedral angle in radians. */
  readonly dihedral: number
  readonly dihedralDeg: number
  /** Length in model units. */
  readonly length: number
}

/** The edges of one face with the face across each, for assembly. */
export function faceEdges(frames: PolyhedronFrames, faceIndex: number): FaceEdgeInfo[] {
  const face = frames.faces[faceIndex]
  if (!face) return []
  const byKey = new Map(frames.edges.map((e) => [`${e.a}-${e.b}`, e]))
  const loop = face.vertexIndices
  return loop.map((a, k) => {
    const b = loop[(k + 1) % loop.length]!
    const e = byKey.get(a < b ? `${a}-${b}` : `${b}-${a}`)!
    const [p, q] = [face.vertices2D[k]!, face.vertices2D[(k + 1) % loop.length]!]
    return {
      k,
      neighbour: e.faces[0] === faceIndex ? e.faces[1] : e.faces[0],
      dihedral: e.dihedral,
      dihedralDeg: e.dihedral * DEG,
      length: Math.hypot(q[0] - p[0], q[1] - p[1]),
    }
  })
}

/** The material is too thick for a panel: an edge would vanish or turn inside out. */
export class PanelError extends Error {
  override name = 'PanelError'
}

/**
 * Move each edge of a strictly convex CCW polygon (y up) inward by its own distance
 * (`insets[k]` for the edge from vertex k to k+1). Vertex k of the result is where the offset
 * lines of edges k−1 and k cross, so vertices keep their indices. Throws `PanelError` if an edge
 * would shrink to nothing or reverse.
 */
export function insetPolygon(ring: readonly Vec2[], insets: readonly number[]): Vec2[] {
  const n = ring.length
  const lines = ring.map((p, k) => {
    const q = ring[(k + 1) % n]!
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    const e: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len]
    const normal: Vec2 = [-e[1], e[0]] // inward for CCW
    return { e, normal, c: normal[0] * p[0] + normal[1] * p[1] + insets[k]! }
  })
  const out = lines.map((cur, k): Vec2 => {
    const prev = lines[(k + n - 1) % n]!
    const det = prev.normal[0] * cur.normal[1] - prev.normal[1] * cur.normal[0]
    if (!(det > 1e-12)) throw new PanelError(`vertex ${k} is not a convex corner`)
    return [
      (prev.c * cur.normal[1] - cur.c * prev.normal[1]) / det,
      (prev.normal[0] * cur.c - cur.normal[0] * prev.c) / det,
    ]
  })
  out.forEach((p, k) => {
    const q = out[(k + 1) % n]!
    const { e } = lines[k]!
    if (!((q[0] - p[0]) * e[0] + (q[1] - p[1]) * e[1] > 0)) {
      throw new PanelError(`edge ${k} vanishes`)
    }
  })
  return out
}

/**
 * The panel as cut (before kerf) in the face's (u, v) frame, model units: the face polygon with
 * every edge inset for a square-cut butt joint. `thickness` is in model units.
 */
export function panelOutline(
  frames: PolyhedronFrames,
  faceIndex: number,
  thickness: number,
): Vec2[] {
  const face = frames.faces[faceIndex]
  if (!face) throw new Error(`no face ${faceIndex}`)
  if (thickness <= 0) return [...face.vertices2D]
  const insets = faceEdges(frames, faceIndex).map((e) => edgeInset(e.dihedral, thickness))
  try {
    return insetPolygon(face.vertices2D, insets)
  } catch (err) {
    if (err instanceof PanelError) {
      throw new PanelError(
        `Material is too thick for face ${faceIndex}: square-cut joints leave no panel ` +
          `(${err.message}). Use thinner material or a larger edge length.`,
      )
    }
    throw err
  }
}

/** A sanded bevel panel in the face's (u, v) frame, model units (plan §14.1). */
export interface BevelOutlines {
  /** The engraved sanding guide: the true face, where the front of the sanded panel ends. */
  readonly guide: Vec2[]
  /** The cut line (before kerf): the guide with every edge moved out by the allowance. */
  readonly cut: Vec2[]
}

/**
 * Sanded bevel panel outlines: butt mode at thickness 0 plus an offset cut. `thickness` moves no
 * line; it only checks that the back face (the square-cut butt panel) still exists. `thickness`
 * and `allowance` are in model units.
 */
export function bevelOutlines(
  frames: PolyhedronFrames,
  faceIndex: number,
  thickness: number,
  allowance: number,
): BevelOutlines {
  const face = frames.faces[faceIndex]
  if (!face) throw new Error(`no face ${faceIndex}`)
  try {
    if (thickness > 0) panelOutline(frames, faceIndex, thickness)
  } catch (err) {
    if (err instanceof PanelError) {
      throw new PanelError(
        err.message.replace('square-cut joints leave no panel', 'bevels leave no back face'),
      )
    }
    throw err
  }
  const guide = [...face.vertices2D]
  const cut =
    allowance > 0
      ? insetPolygon(
          guide,
          guide.map(() => -allowance),
        )
      : [...guide]
  return { guide, cut }
}

/**
 * Inward unit normals of the planes through the origin and each edge of a polygon on the face
 * plane, like `FaceFrame.edgePlanes`. Gnomonic projection maps these great circles to the
 * polygon's edges, so clipping on the sphere against them clips exactly to the polygon.
 */
export function polygonConePlanes(face: FaceFrame, polygon: readonly Vec2[]): Vec3[] {
  const pts = polygon.map((p) => planePoint(face, p))
  return pts.map((p, i) => normalize(cross(p, pts[(i + 1) % pts.length]!)))
}
