import { type Vec3, distance } from '../vec3'
import { convexHullFaces } from './hull'
import { preprocess } from './preprocess'
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

/** Hull the vertex set, scale to unit edge length, and run the normal preprocessing. */
function fromVertices(name: string, points: Vec3[]): PolyhedronDef {
  let minEdge = Infinity
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      minEdge = Math.min(minEdge, distance(points[i]!, points[j]!))
  const vertices = points.map(([x, y, z]): Vec3 => [x / minEdge, y / minEdge, z / minEdge])
  return preprocess({ name, vertices, faces: convexHullFaces(vertices) })
}

/** Presets, generated in code rather than typed in (plan §6.1). All have edge length 1. */
export const PRESETS = {
  tetrahedron: {
    label: 'Tetrahedron',
    build: () =>
      fromVertices('tetrahedron', [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
      ]),
  },
  cube: { label: 'Cube', build: () => fromVertices('cube', signs([1, 1, 1])) },
  octahedron: {
    label: 'Octahedron',
    build: () => fromVertices('octahedron', cyclic([1, 0, 0]).flatMap(signs)),
  },
  dodecahedron: {
    label: 'Dodecahedron',
    build: () =>
      fromVertices('dodecahedron', [
        ...signs([1, 1, 1]),
        ...cyclic([0, 1 / PHI, PHI]).flatMap(signs),
      ]),
  },
  icosahedron: {
    label: 'Icosahedron',
    build: () => fromVertices('icosahedron', cyclic([0, 1, PHI]).flatMap(signs)),
  },
  'truncated-icosahedron': {
    label: 'Truncated icosahedron',
    build: () =>
      fromVertices('truncated-icosahedron', [
        ...cyclic([0, 1, 3 * PHI]).flatMap(signs),
        ...cyclic([1, 2 + PHI, 2 * PHI]).flatMap(signs),
        ...cyclic([PHI, 2, PHI ** 3]).flatMap(signs),
      ]),
  },
} as const satisfies Record<string, { label: string; build: () => PolyhedronDef }>

export type PresetId = keyof typeof PRESETS

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[]

export const isPresetId = (s: string): s is PresetId => s in PRESETS

const cache = new Map<PresetId, PolyhedronDef>()

/** A preset's definition (built once). */
export function preset(id: PresetId): PolyhedronDef {
  let def = cache.get(id)
  if (!def) {
    def = PRESETS[id].build()
    cache.set(id, def)
  }
  return def
}

/** Regular icosahedron with edge length 1, centred on the origin. */
export const icosahedron = (): PolyhedronDef => preset('icosahedron')
