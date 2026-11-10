import type { PolyhedronFrames } from './polyhedron/faces'

const DEG = 180 / Math.PI

/**
 * Butt joint with outer faces meeting (plan §3): square-cut panels touch along the outer edge
 * and open a V on the inside. Its angle is 180° − dihedral, and at the inner surface the gap
 * between two panels of thickness t is 2·t·sin(V / 2).
 */
export function vGap(dihedralRad: number, thicknessMm: number) {
  const v = Math.PI - dihedralRad
  return { angleDeg: v * DEG, innerGapMm: 2 * thicknessMm * Math.sin(v / 2) }
}

export interface DihedralGroup {
  readonly dihedralDeg: number
  readonly vGapDeg: number
  readonly innerGapMm: number
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
        innerGapMm: gap.innerGapMm,
        edgeCount: count,
      }
    })
}

export interface FaceEdgeInfo {
  /** Position in the face's vertex loop: edge k runs from vertex k to vertex k+1. */
  readonly k: number
  readonly neighbour: number
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
      dihedralDeg: e.dihedral * DEG,
      length: Math.hypot(q[0] - p[0], q[1] - p[1]),
    }
  })
}
