import { type Vec3, distance, scale } from '../vec3'
import { buildFrames } from './faces'
import { convexHullFaces } from './hull'
import { preprocess } from './preprocess'
import type { PolyhedronDef } from './types'

const PHI = (1 + Math.sqrt(5)) / 2
const SQRT2 = Math.SQRT2

/** Tribonacci constant: real root of t³ = t² + t + 1 (snub cube). */
const TRIBONACCI = (1 + Math.cbrt(19 + 3 * Math.sqrt(33)) + Math.cbrt(19 - 3 * Math.sqrt(33))) / 3

/** Real root of ξ³ − 2ξ = φ (snub dodecahedron), by Newton's method. */
const XI = (() => {
  let x = 1.7
  for (let i = 0; i < 50; i++) x -= (x ** 3 - 2 * x - PHI) / (3 * x ** 2 - 2)
  return x
})()

/** Even (cyclic) permutations of (x, y, z). */
const evenPerms = ([x, y, z]: Vec3): Vec3[] => [
  [x, y, z],
  [y, z, x],
  [z, x, y],
]

/** Odd permutations of (x, y, z). */
const oddPerms = ([x, y, z]: Vec3): Vec3[] => [
  [y, x, z],
  [x, z, y],
  [z, y, x],
]

const allPerms = (v: Vec3): Vec3[] => [...evenPerms(v), ...oddPerms(v)]

/** Every sign combination of the non-zero components. */
function signs([x, y, z]: Vec3): Vec3[] {
  const out: Vec3[] = []
  for (const sx of x === 0 ? [1] : [1, -1])
    for (const sy of y === 0 ? [1] : [1, -1])
      for (const sz of z === 0 ? [1] : [1, -1]) out.push([sx * x, sy * y, sz * z])
  return out
}

/** Sign combinations with an even (or odd) number of minus signs, of all three components. */
function signsWithParity([x, y, z]: Vec3, minusCount: 'even' | 'odd'): Vec3[] {
  const out: Vec3[] = []
  for (const sx of [1, -1])
    for (const sy of [1, -1])
      for (const sz of [1, -1]) {
        const minus = [sx, sy, sz].filter((s) => s < 0).length
        if ((minus % 2 === 0) === (minusCount === 'even')) out.push([sx * x, sy * y, sz * z])
      }
  return out
}

/** Remove duplicates (permutations of vectors with repeated or zero components). */
function unique(points: Vec3[]): Vec3[] {
  const seen = new Set<string>()
  return points.filter((p) => {
    const key = p.map((c) => (Math.abs(c) < 1e-12 ? 0 : c).toFixed(9)).join(',')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Hull the vertex set, scale to unit edge length, and run the normal preprocessing. */
function fromVertices(name: string, raw: Vec3[]): PolyhedronDef {
  const points = unique(raw)
  let minEdge = Infinity
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      minEdge = Math.min(minEdge, distance(points[i]!, points[j]!))
  const vertices = points.map(([x, y, z]): Vec3 => [x / minEdge, y / minEdge, z / minEdge])
  return preprocess({ name, vertices, faces: convexHullFaces(vertices) })
}

/**
 * Catalan solid as the dual of an Archimedean solid, by polar reciprocation: each face plane
 * n·x = d becomes the vertex n/d. Archimedean solids have a midsphere, so this gives the
 * canonical Catalan shape (up to scale). Scaled so the longest edge is 1 (plan §3 sizing).
 */
function dualOf(name: string, archimedean: string): PolyhedronDef {
  if (!isPresetId(archimedean)) throw new Error(`unknown preset ${archimedean}`)
  const frames = buildFrames(preset(archimedean))
  const points = frames.faces.map((f) => scale(f.normal, 1 / f.distance))
  const def = preprocess({ name, vertices: points, faces: convexHullFaces(points) })
  let longest = 0
  for (const f of def.faces)
    f.forEach((a, k) => {
      longest = Math.max(longest, distance(def.vertices[a]!, def.vertices[f[(k + 1) % f.length]!]!))
    })
  return { ...def, vertices: def.vertices.map((v) => scale(v, 1 / longest)) }
}

export type PresetFamily = 'platonic' | 'archimedean' | 'catalan'

interface PresetSpec {
  readonly label: string
  readonly family: PresetFamily
  /** Face count, for the picker, without building the shape. */
  readonly faces: number
  readonly build: () => PolyhedronDef
}

/**
 * Presets, generated in code from their standard Cartesian coordinates rather than typed in
 * (plan §6.1). All have unit edge length. Chiral snubs use one handedness.
 */
export const PRESETS = {
  // --- Platonic solids ---
  tetrahedron: {
    label: 'Tetrahedron',
    family: 'platonic',
    faces: 4,
    build: () => fromVertices('tetrahedron', signsWithParity([1, 1, 1], 'even')),
  },
  cube: {
    label: 'Cube',
    family: 'platonic',
    faces: 6,
    build: () => fromVertices('cube', signs([1, 1, 1])),
  },
  octahedron: {
    label: 'Octahedron',
    family: 'platonic',
    faces: 8,
    build: () => fromVertices('octahedron', evenPerms([1, 0, 0]).flatMap(signs)),
  },
  dodecahedron: {
    label: 'Dodecahedron',
    family: 'platonic',
    faces: 12,
    build: () =>
      fromVertices('dodecahedron', [
        ...signs([1, 1, 1]),
        ...evenPerms([0, 1 / PHI, PHI]).flatMap(signs),
      ]),
  },
  icosahedron: {
    label: 'Icosahedron',
    family: 'platonic',
    faces: 20,
    build: () => fromVertices('icosahedron', evenPerms([0, 1, PHI]).flatMap(signs)),
  },

  // --- Archimedean solids (octahedral / tetrahedral symmetry) ---
  'truncated-tetrahedron': {
    label: 'Truncated tetrahedron',
    family: 'archimedean',
    faces: 8,
    build: () =>
      fromVertices(
        'truncated-tetrahedron',
        allPerms([3, 1, 1]).flatMap((v) => signsWithParity(v, 'even')),
      ),
  },
  cuboctahedron: {
    label: 'Cuboctahedron',
    family: 'archimedean',
    faces: 14,
    build: () => fromVertices('cuboctahedron', allPerms([1, 1, 0]).flatMap(signs)),
  },
  'truncated-cube': {
    label: 'Truncated cube',
    family: 'archimedean',
    faces: 14,
    build: () => fromVertices('truncated-cube', allPerms([SQRT2 - 1, 1, 1]).flatMap(signs)),
  },
  'truncated-octahedron': {
    label: 'Truncated octahedron',
    family: 'archimedean',
    faces: 14,
    build: () => fromVertices('truncated-octahedron', allPerms([0, 1, 2]).flatMap(signs)),
  },
  rhombicuboctahedron: {
    label: 'Rhombicuboctahedron',
    family: 'archimedean',
    faces: 26,
    build: () => fromVertices('rhombicuboctahedron', allPerms([1, 1, 1 + SQRT2]).flatMap(signs)),
  },
  'truncated-cuboctahedron': {
    label: 'Truncated cuboctahedron',
    family: 'archimedean',
    faces: 26,
    build: () =>
      fromVertices(
        'truncated-cuboctahedron',
        allPerms([1, 1 + SQRT2, 1 + 2 * SQRT2]).flatMap(signs),
      ),
  },
  'snub-cube': {
    label: 'Snub cube',
    family: 'archimedean',
    faces: 38,
    build: () => {
      const t = TRIBONACCI
      const base: Vec3 = [1, 1 / t, t]
      // Even permutations with an even number of plus signs (= odd number of minus signs),
      // odd permutations with an odd number of plus signs (= even number of minus signs).
      return fromVertices('snub-cube', [
        ...evenPerms(base).flatMap((v) => signsWithParity(v, 'odd')),
        ...oddPerms(base).flatMap((v) => signsWithParity(v, 'even')),
      ])
    },
  },

  // --- Archimedean solids (icosahedral symmetry) ---
  icosidodecahedron: {
    label: 'Icosidodecahedron',
    family: 'archimedean',
    faces: 32,
    build: () =>
      fromVertices('icosidodecahedron', [
        ...evenPerms([0, 0, PHI]).flatMap(signs),
        ...evenPerms([0.5, PHI / 2, (PHI * PHI) / 2]).flatMap(signs),
      ]),
  },
  'truncated-dodecahedron': {
    label: 'Truncated dodecahedron',
    family: 'archimedean',
    faces: 32,
    build: () =>
      fromVertices('truncated-dodecahedron', [
        ...evenPerms([0, 1 / PHI, 2 + PHI]).flatMap(signs),
        ...evenPerms([1 / PHI, PHI, 2 * PHI]).flatMap(signs),
        ...evenPerms([PHI, 2, PHI + 1]).flatMap(signs),
      ]),
  },
  'truncated-icosahedron': {
    label: 'Truncated icosahedron',
    family: 'archimedean',
    faces: 32,
    build: () =>
      fromVertices('truncated-icosahedron', [
        ...evenPerms([0, 1, 3 * PHI]).flatMap(signs),
        ...evenPerms([1, 2 + PHI, 2 * PHI]).flatMap(signs),
        ...evenPerms([PHI, 2, PHI ** 3]).flatMap(signs),
      ]),
  },
  rhombicosidodecahedron: {
    label: 'Rhombicosidodecahedron',
    family: 'archimedean',
    faces: 62,
    build: () =>
      fromVertices('rhombicosidodecahedron', [
        ...evenPerms([1, 1, PHI ** 3]).flatMap(signs),
        ...evenPerms([PHI ** 2, PHI, 2 * PHI]).flatMap(signs),
        ...evenPerms([2 + PHI, 0, PHI ** 2]).flatMap(signs),
      ]),
  },
  'truncated-icosidodecahedron': {
    label: 'Truncated icosidodecahedron',
    family: 'archimedean',
    faces: 62,
    build: () =>
      fromVertices('truncated-icosidodecahedron', [
        ...evenPerms([1 / PHI, 1 / PHI, 3 + PHI]).flatMap(signs),
        ...evenPerms([2 / PHI, PHI, 1 + 2 * PHI]).flatMap(signs),
        ...evenPerms([1 / PHI, PHI ** 2, -1 + 3 * PHI]).flatMap(signs),
        ...evenPerms([2 * PHI - 1, 2, 2 + PHI]).flatMap(signs),
        ...evenPerms([PHI, 3, 2 * PHI]).flatMap(signs),
      ]),
  },
  'snub-dodecahedron': {
    label: 'Snub dodecahedron',
    family: 'archimedean',
    faces: 92,
    build: () => {
      const a = XI - 1 / XI
      const b = XI * PHI + PHI ** 2 + PHI / XI
      const bases: Vec3[] = [
        [2 * a, 2, 2 * b],
        [a + b / PHI + PHI, -a * PHI + b + 1 / PHI, a / PHI + b * PHI - 1],
        [-a / PHI + b * PHI + 1, -a + b / PHI - PHI, a * PHI + b - 1 / PHI],
        [-a / PHI + b * PHI - 1, a - b / PHI - PHI, a * PHI + b + 1 / PHI],
        [a + b / PHI - PHI, a * PHI - b + 1 / PHI, a / PHI + b * PHI + 1],
      ]
      // Even permutations with an even number of plus signs (= odd number of minus signs).
      return fromVertices(
        'snub-dodecahedron',
        bases.flatMap(evenPerms).flatMap((v) => signsWithParity(v, 'odd')),
      )
    },
  },

  // --- Catalan solids (Archimedean duals: every face identical) ---
  'triakis-tetrahedron': {
    label: 'Triakis tetrahedron',
    family: 'catalan',
    faces: 12,
    build: () => dualOf('triakis-tetrahedron', 'truncated-tetrahedron'),
  },
  'rhombic-dodecahedron': {
    label: 'Rhombic dodecahedron',
    family: 'catalan',
    faces: 12,
    build: () => dualOf('rhombic-dodecahedron', 'cuboctahedron'),
  },
  'triakis-octahedron': {
    label: 'Triakis octahedron',
    family: 'catalan',
    faces: 24,
    build: () => dualOf('triakis-octahedron', 'truncated-cube'),
  },
  'tetrakis-hexahedron': {
    label: 'Tetrakis hexahedron',
    family: 'catalan',
    faces: 24,
    build: () => dualOf('tetrakis-hexahedron', 'truncated-octahedron'),
  },
  'deltoidal-icositetrahedron': {
    label: 'Deltoidal icositetrahedron',
    family: 'catalan',
    faces: 24,
    build: () => dualOf('deltoidal-icositetrahedron', 'rhombicuboctahedron'),
  },
  'disdyakis-dodecahedron': {
    label: 'Disdyakis dodecahedron',
    family: 'catalan',
    faces: 48,
    build: () => dualOf('disdyakis-dodecahedron', 'truncated-cuboctahedron'),
  },
  'pentagonal-icositetrahedron': {
    label: 'Pentagonal icositetrahedron',
    family: 'catalan',
    faces: 24,
    build: () => dualOf('pentagonal-icositetrahedron', 'snub-cube'),
  },
  'rhombic-triacontahedron': {
    label: 'Rhombic triacontahedron',
    family: 'catalan',
    faces: 30,
    build: () => dualOf('rhombic-triacontahedron', 'icosidodecahedron'),
  },
  'triakis-icosahedron': {
    label: 'Triakis icosahedron',
    family: 'catalan',
    faces: 60,
    build: () => dualOf('triakis-icosahedron', 'truncated-dodecahedron'),
  },
  'pentakis-dodecahedron': {
    label: 'Pentakis dodecahedron',
    family: 'catalan',
    faces: 60,
    build: () => dualOf('pentakis-dodecahedron', 'truncated-icosahedron'),
  },
  'deltoidal-hexecontahedron': {
    label: 'Deltoidal hexecontahedron',
    family: 'catalan',
    faces: 60,
    build: () => dualOf('deltoidal-hexecontahedron', 'rhombicosidodecahedron'),
  },
  'disdyakis-triacontahedron': {
    label: 'Disdyakis triacontahedron',
    family: 'catalan',
    faces: 120,
    build: () => dualOf('disdyakis-triacontahedron', 'truncated-icosidodecahedron'),
  },
  'pentagonal-hexecontahedron': {
    label: 'Pentagonal hexecontahedron',
    family: 'catalan',
    faces: 60,
    build: () => dualOf('pentagonal-hexecontahedron', 'snub-dodecahedron'),
  },
} as const satisfies Record<string, PresetSpec>

export type PresetId = keyof typeof PRESETS

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[]

export const isPresetId = (s: string): s is PresetId => s in PRESETS

const cache = new Map<PresetId, PolyhedronDef>()

/** A preset's definition (built once, on first use). */
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
