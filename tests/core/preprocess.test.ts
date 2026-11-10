import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildFrames } from '@/core/polyhedron/faces'
import { importPolyhedron, slugify } from '@/core/polyhedron/import'
import { parsePolyhedronJson } from '@/core/polyhedron/json'
import { parseObj } from '@/core/polyhedron/obj'
import { PolyhedronError, preprocess } from '@/core/polyhedron/preprocess'
import { PRESETS, PRESET_IDS, type PresetId, preset } from '@/core/polyhedron/presets'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import { rotate } from '@/core/quat'
import { type Vec3, distance, dot, length } from '@/core/vec3'

import { rotation } from '../arbitraries'

// ---------- helpers ----------

type Triangulation = 'none' | 'fan' | 'centre'

/** Split polygons into triangles, optionally around a new centre vertex (like many exporters). */
function triangulate(def: PolyhedronDef, mode: Triangulation): PolyhedronDef {
  if (mode === 'none') return def
  const vertices = [...def.vertices]
  const faces: number[][] = []
  for (const f of def.faces) {
    if (f.length === 3) {
      faces.push([...f])
    } else if (mode === 'fan') {
      for (let k = 1; k + 1 < f.length; k++) faces.push([f[0]!, f[k]!, f[k + 1]!])
    } else {
      const c = f.reduce<Vec3>(
        (s, i) => [
          s[0] + def.vertices[i]![0],
          s[1] + def.vertices[i]![1],
          s[2] + def.vertices[i]![2],
        ],
        [0, 0, 0],
      )
      const ci = vertices.push([c[0] / f.length, c[1] / f.length, c[2] / f.length]) - 1
      f.forEach((a, k) => faces.push([ci, a, f[(k + 1) % f.length]!]))
    }
  }
  return { ...def, vertices, faces }
}

/**
 * OBJ text with every face using its own copy of each vertex (unwelded, like STL-derived
 * exports), tiny noise, mixed `f a/b/c` syntax and negative indices.
 */
function toUnweldedObj(def: PolyhedronDef, noise = 1e-9): string {
  const lines = ['# test fixture', 'o shape']
  let count = 0
  def.faces.forEach((f, fi) => {
    for (const i of f) {
      const [x, y, z] = def.vertices[i]!
      const j = (count * 7919) % 13
      lines.push(`v ${x + noise * (j - 6)} ${y - noise * (j - 5)} ${z} 1.0`)
      count++
    }
    const refs = f.map((_, k) =>
      fi % 2 === 0 ? `${count - f.length + k + 1}/1/1` : `${k - f.length}//2`,
    )
    lines.push(`f ${refs.join(' ')}`)
  })
  return lines.join('\n')
}

function transform(def: PolyhedronDef, f: (p: Vec3) => Vec3): PolyhedronDef {
  return { ...def, vertices: def.vertices.map(f) }
}

const edgeLengths = (def: PolyhedronDef) =>
  def.faces.flatMap((f) =>
    f.map((a, k) => distance(def.vertices[a]!, def.vertices[f[(k + 1) % f.length]!]!)),
  )

const expectError = (fn: () => unknown, pattern: RegExp) => {
  expect(fn).toThrow(PolyhedronError)
  expect(fn).toThrow(pattern)
}

const cubeVerts: Vec3[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
]
/** Cube faces, CCW from outside. */
const cubeFaces = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [1, 2, 6, 5],
  [0, 4, 7, 3],
]
const cube: PolyhedronDef = { name: 'cube', vertices: cubeVerts, faces: cubeFaces }

// ---------- presets ----------

describe('presets', () => {
  /** [V, E, F, { sides: count }] from the standard tables. */
  const expected: Record<PresetId, [number, number, number, Record<number, number>]> = {
    tetrahedron: [4, 6, 4, { 3: 4 }],
    cube: [8, 12, 6, { 4: 6 }],
    octahedron: [6, 12, 8, { 3: 8 }],
    dodecahedron: [20, 30, 12, { 5: 12 }],
    icosahedron: [12, 30, 20, { 3: 20 }],
    'truncated-tetrahedron': [12, 18, 8, { 3: 4, 6: 4 }],
    cuboctahedron: [12, 24, 14, { 3: 8, 4: 6 }],
    'truncated-cube': [24, 36, 14, { 3: 8, 8: 6 }],
    'truncated-octahedron': [24, 36, 14, { 4: 6, 6: 8 }],
    rhombicuboctahedron: [24, 48, 26, { 3: 8, 4: 18 }],
    'truncated-cuboctahedron': [48, 72, 26, { 4: 12, 6: 8, 8: 6 }],
    'snub-cube': [24, 60, 38, { 3: 32, 4: 6 }],
    icosidodecahedron: [30, 60, 32, { 3: 20, 5: 12 }],
    'truncated-dodecahedron': [60, 90, 32, { 3: 20, 10: 12 }],
    'truncated-icosahedron': [60, 90, 32, { 5: 12, 6: 20 }],
    rhombicosidodecahedron: [60, 120, 62, { 3: 20, 4: 30, 5: 12 }],
    'truncated-icosidodecahedron': [120, 180, 62, { 4: 30, 6: 20, 10: 12 }],
    'snub-dodecahedron': [60, 150, 92, { 3: 80, 5: 12 }],
    'triakis-tetrahedron': [8, 18, 12, { 3: 12 }],
    'rhombic-dodecahedron': [14, 24, 12, { 4: 12 }],
    'triakis-octahedron': [14, 36, 24, { 3: 24 }],
    'tetrakis-hexahedron': [14, 36, 24, { 3: 24 }],
    'deltoidal-icositetrahedron': [26, 48, 24, { 4: 24 }],
    'disdyakis-dodecahedron': [26, 72, 48, { 3: 48 }],
    'pentagonal-icositetrahedron': [38, 60, 24, { 5: 24 }],
    'rhombic-triacontahedron': [32, 60, 30, { 4: 30 }],
    'triakis-icosahedron': [32, 90, 60, { 3: 60 }],
    'pentakis-dodecahedron': [32, 90, 60, { 3: 60 }],
    'deltoidal-hexecontahedron': [62, 120, 60, { 4: 60 }],
    'disdyakis-triacontahedron': [62, 180, 120, { 3: 120 }],
    'pentagonal-hexecontahedron': [92, 150, 60, { 5: 60 }],
  }

  const family = (f: string) => PRESET_IDS.filter((id) => PRESETS[id].family === f)

  it.each(PRESET_IDS)('%s has the right V/E/F and face types, centred', (id) => {
    const def = preset(id)
    const frames = buildFrames(def)
    const [v, e, f, sides] = expected[id]
    expect([def.vertices.length, frames.edges.length, def.faces.length]).toEqual([v, e, f])
    const counts: Record<number, number> = {}
    for (const face of def.faces) counts[face.length] = (counts[face.length] ?? 0) + 1
    expect(counts).toEqual(sides)
    expect(PRESETS[id].faces).toBe(f) // picker metadata matches the built shape
    // Platonic/Archimedean: all edges 1. Catalan: longest edge 1 (plan §3 sizing).
    const lengths = edgeLengths(def)
    expect(Math.max(...lengths)).toBeCloseTo(1, 12)
    if (PRESETS[id].family !== 'catalan') for (const e of lengths) expect(e).toBeCloseTo(1, 12)
    const c = def.vertices.reduce<Vec3>(
      (s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]],
      [0, 0, 0],
    )
    expect(length(c)).toBeLessThan(1e-12)
  })

  it.each(family('catalan'))(
    '%s is face-uniform: insphere, one dihedral, congruent faces',
    (id) => {
      const frames = buildFrames(preset(id))
      for (const f of frames.faces) expect(f.distance).toBeCloseTo(frames.faces[0]!.distance, 12)
      for (const e of frames.edges) expect(e.dihedral).toBeCloseTo(frames.edges[0]!.dihedral, 12)
      // Same multiset of side lengths and interior angles on every face.
      const signature = (pts: readonly (readonly [number, number])[]) => {
        const n = pts.length
        const sides = pts.map((p, k) => {
          const q = pts[(k + 1) % n]!
          return Math.hypot(q[0] - p[0], q[1] - p[1])
        })
        const angles = pts.map((p, k) => {
          const a = pts[(k + n - 1) % n]!
          const b = pts[(k + 1) % n]!
          const u = [a[0] - p[0], a[1] - p[1]]
          const v = [b[0] - p[0], b[1] - p[1]]
          return Math.atan2(u[0]! * v[1]! - u[1]! * v[0]!, u[0]! * v[0]! + u[1]! * v[1]!)
        })
        const r = (xs: number[]) =>
          xs
            .map((x) => Math.abs(x).toFixed(9))
            .sort()
            .join(',')
        return `${r(sides)}|${r(angles)}`
      }
      const first = signature(frames.faces[0]!.vertices2D)
      for (const f of frames.faces) expect(signature(f.vertices2D)).toBe(first)
    },
  )

  it.each(family('catalan'))('%s is the exact dual of its Archimedean partner (V ↔ F)', (id) => {
    const archimedean = family('archimedean')
    const [v, e, f] = expected[id]
    const partner = archimedean.filter((a) => {
      const [av, ae, af] = expected[a]
      return av === f && af === v && ae === e
    })
    expect(partner.length).toBeGreaterThanOrEqual(1)
  })

  it.each([...family('platonic'), ...family('archimedean')])(
    '%s is vertex-uniform: every vertex on one sphere',
    (id) => {
      const radii = preset(id).vertices.map(length)
      for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 12)
    },
  )

  it('snubs and their duals are chiral: not equal to their mirror image', () => {
    for (const id of [
      'snub-cube',
      'snub-dodecahedron',
      'pentagonal-icositetrahedron',
      'pentagonal-hexecontahedron',
    ] as const) {
      const def = preset(id)
      const key = (p: Vec3) => p.map((c) => c.toFixed(6)).join(',')
      const verts = new Set(def.vertices.map(key))
      // A mirror (x → −x) maps the vertex set onto a different set.
      const mirrored = def.vertices.map(([x, y, z]): Vec3 => [-x, y, z])
      expect(mirrored.every((p) => verts.has(key(p)))).toBe(false)
    }
  })

  it('truncated icosahedron has two plane distances and no insphere (plan §4.1)', () => {
    const frames = buildFrames(preset('truncated-icosahedron'))
    const byType = (n: number) => frames.faces.filter((f) => f.vertices.length === n)
    expect(byType(5)).toHaveLength(12)
    expect(byType(6)).toHaveLength(20)
    for (const f of byType(5)) expect(f.distance).toBeCloseTo(2.327, 3)
    for (const f of byType(6)) expect(f.distance).toBeCloseTo(2.267, 3)
  })

  it('preprocessing a preset again changes nothing', () => {
    for (const id of PRESET_IDS) {
      const again = preprocess(preset(id))
      expect(again.faces).toEqual(preset(id).faces)
      again.vertices.forEach((v, i) =>
        expect(distance(v, preset(id).vertices[i]!)).toBeLessThan(1e-12),
      )
    }
  })
})

// ---------- import acceptance (plan §9) ----------

const offset = fc.double({ min: -100, max: 100, noNaN: true })

describe('triangulated OBJ import', () => {
  it.each([
    ['icosahedron', 'fan', 20, 12],
    ['dodecahedron', 'fan', 12, 20],
    ['dodecahedron', 'centre', 12, 20],
    ['cube', 'fan', 6, 8],
    ['truncated-icosahedron', 'centre', 32, 60],
  ] as const)(
    '%s (%s-triangulated, unwelded) merges back to %d faces',
    (id, mode, faces, verts) => {
      const def = importPolyhedron(`My ${id}.obj`, toUnweldedObj(triangulate(preset(id), mode)))
      expect(def.faces).toHaveLength(faces)
      expect(def.vertices).toHaveLength(verts)
      expect(def.name).toBe(slugify(`My ${id}`))
      for (const e of edgeLengths(def)) expect(e).toBeCloseTo(1, 6)
      expect(() => buildFrames(def)).not.toThrow()
    },
  )

  it('recovers any preset under random rotation, scale, offset, winding flips and face order', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESET_IDS),
        fc.constantFrom<Triangulation>('none', 'fan', 'centre'),
        rotation,
        fc.double({ min: 0.01, max: 1000, noNaN: true }),
        fc.tuple(offset, offset, offset),
        fc.array(fc.boolean(), { minLength: 200, maxLength: 200 }),
        fc.integer({ min: 0, max: 1000 }),
        (id, mode, q, s, [tx, ty, tz], flips, seed) => {
          const base = triangulate(preset(id), mode)
          const moved = transform(base, (p) => {
            const r = rotate(q, p)
            return [r[0] * s + tx, r[1] * s + ty, r[2] * s + tz]
          })
          const faces = moved.faces
            .map((f, i) => (flips[i % flips.length] ? [...f].reverse() : [...f]))
            .map((f, i) => ({ f, k: (i * 7919 + seed) % 1009 }))
            .sort((a, b) => a.k - b.k)
            .map(({ f }) => f)
          const def = preprocess({ ...moved, faces })
          const frames = buildFrames(def) // throws unless every face is CCW from outside
          expect(def.faces).toHaveLength(preset(id).faces.length)
          for (const face of frames.faces) {
            for (const v of def.vertices) {
              expect(dot(face.normal, v)).toBeLessThanOrEqual(face.distance * (1 + 1e-9))
            }
          }
        },
      ),
      { numRuns: 60 },
    )
  })
})

// ---------- individual steps ----------

describe('preprocess steps', () => {
  it('welds duplicate vertices within tolerance', () => {
    const def = preprocess(parseObj(toUnweldedObj(cube, 1e-8), 'cube'))
    expect(def.vertices).toHaveLength(8)
    expect(def.faces).toHaveLength(6)
  })

  it('merges coplanar triangles and drops the now-unused centre vertices', () => {
    const def = preprocess(triangulate(cube, 'centre'))
    expect(def.faces).toHaveLength(6)
    expect(def.vertices).toHaveLength(8)
  })

  it('removes collinear vertices on edges', () => {
    // Add a midpoint on edge 1–2, used by both neighbouring faces.
    const vertices: Vec3[] = [...cubeVerts, [1, 0, -1]]
    const faces = cubeFaces.map((f) => {
      const out: number[] = []
      f.forEach((a, k) => {
        out.push(a)
        const b = f[(k + 1) % f.length]
        if ((a === 1 && b === 2) || (a === 2 && b === 1)) out.push(8)
      })
      return out
    })
    const def = preprocess({ name: 'cube', vertices, faces })
    expect(def.vertices).toHaveLength(8)
    for (const f of def.faces) expect(f).toHaveLength(4)
  })

  it('orients inward-wound faces CCW from outside', () => {
    const def = preprocess({ ...cube, faces: cubeFaces.map((f) => [...f].reverse()) })
    for (const face of buildFrames(def).faces) {
      const c = face.vertices.reduce<Vec3>(
        (s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]],
        [0, 0, 0],
      )
      expect(dot(face.normal, c)).toBeGreaterThan(0)
    }
  })

  it('centres the vertex centroid on the origin', () => {
    const def = preprocess(transform(cube, ([x, y, z]) => [x + 50, y - 3, z + 7]))
    const c = def.vertices.reduce<Vec3>(
      (s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]],
      [0, 0, 0],
    )
    expect(length(c)).toBeLessThan(1e-12)
  })

  it('keeps face order predictable (merged faces take their first member’s place)', () => {
    const def = preprocess(triangulate(cube, 'fan'))
    // Fan-triangulated cube: triangles 2k and 2k+1 come from cube face k.
    const normals = buildFrames(def).faces.map((f) => f.normal.map((c) => Math.round(c)))
    expect(normals).toEqual([
      [0, 0, -1],
      [0, 0, 1],
      [0, -1, 0],
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
    ])
  })
})

// ---------- rejection ----------

describe('rejects unusable shapes with clear messages', () => {
  it('non-convex: a dented cube', () => {
    const dented = triangulate(cube, 'fan')
    const vertices = [...dented.vertices]
    vertices[6] = [0.5, 0.5, 0.5] // push a corner inwards
    expectError(
      () => preprocess({ ...dented, vertices }),
      /^not convex: vertex \d+ is [\d.]+% of the model size outside the plane of face \d+/,
    )
  })

  it('non-manifold: an open box', () => {
    expectError(
      () => preprocess({ ...cube, faces: cubeFaces.slice(1) }),
      /not closed: edge \d+–\d+ belongs only to face \d+/,
    )
  })

  it('non-manifold: an edge shared by three faces', () => {
    const fin = {
      ...cube,
      vertices: [...cubeVerts, [0, -3, -1] as Vec3],
      faces: [...cubeFaces, [0, 1, 8]],
    }
    expectError(() => preprocess(fin), /not manifold: edge 0–1 is shared by faces/)
  })

  it('separate pieces', () => {
    const shifted = cubeVerts.map(([x, y, z]): Vec3 => [x + 5, y, z])
    const two = {
      name: 'two',
      vertices: [...cubeVerts, ...shifted],
      faces: [...cubeFaces, ...cubeFaces.map((f) => f.map((i) => i + 8))],
    }
    expectError(() => preprocess(two), /separate pieces/)
  })

  it('non-planar faces', () => {
    const vertices = [...cubeVerts]
    vertices[6] = [1.1, 1, 1] // one corner off its three quads' planes
    expectError(() => preprocess({ ...cube, vertices }), /face \d+ is not flat: vertex \d+ is/)
  })

  it('a flat, zero-volume shape', () => {
    const square: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]
    const pillow = {
      name: 'flat',
      vertices: square,
      faces: [
        [0, 1, 2],
        [0, 2, 3],
        [1, 0, 3],
        [1, 3, 2],
      ],
    }
    expectError(() => preprocess(pillow), /the shape is flat/)
  })

  it('bad indices and tiny inputs', () => {
    expectError(() => preprocess({ ...cube, faces: [...cubeFaces, [0, 1, 99]] }), /vertex 99/)
    expectError(
      () => preprocess({ name: 'x', vertices: cubeVerts.slice(0, 3), faces: [] }),
      /at least 4 vertices/,
    )
  })
})

// ---------- parsers ----------

describe('parseObj', () => {
  it('reads v/f lines, ignores everything else, supports a/b/c and negative indices', () => {
    const def = parseObj(
      [
        'mtllib x.mtl',
        'v 0 0 0',
        'v 1 0 0 # trailing comment',
        'vt 0 0',
        'vn 0 0 1',
        'v 0 1 0',
        'usemtl foo',
        'f 1/1/1 2//1 3',
        'f -3 -2 -1',
        's off',
      ].join('\r\n'),
      'tri',
    )
    expect(def.vertices).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ])
    expect(def.faces).toEqual([
      [0, 1, 2],
      [0, 1, 2],
    ])
  })

  it('reports errors with line numbers', () => {
    expectError(() => parseObj('v 0 0\n', 'x'), /OBJ line 1: expected "v x y z"/)
    expectError(() => parseObj('v 0 0 0\nf 1 2\n', 'x'), /OBJ line 2: a face needs at least 3/)
    expectError(() => parseObj('v 0 0 0\nf 1 -5 1\n', 'x'), /OBJ line 2: vertex reference -5/)
    expectError(() => parseObj('v 0 0 0\n', 'x'), /contains no faces/)
  })
})

describe('parsePolyhedronJson', () => {
  it('reads vertices, faces and an optional name', () => {
    const def = parsePolyhedronJson(JSON.stringify({ ...cube, name: 'Box' }), 'fallback')
    expect(def.name).toBe('Box')
    expect(def.faces).toEqual(cubeFaces)
    expect(parsePolyhedronJson(JSON.stringify({ vertices: [], faces: [] }), 'fb').name).toBe('fb')
  })

  it('reports malformed input', () => {
    expectError(() => parsePolyhedronJson('{', 'x'), /not valid JSON/)
    expectError(() => parsePolyhedronJson('[]', 'x'), /"vertices" must be an array/)
    expectError(
      () => parsePolyhedronJson('{"vertices":[[0,0]],"faces":[]}', 'x'),
      /vertices\[0\] must be \[x, y, z\]/,
    )
    expectError(
      () => parsePolyhedronJson('{"vertices":[],"faces":[[0,-1,2]]}', 'x'),
      /faces\[0\] must be an array of vertex indices/,
    )
  })
})

describe('importPolyhedron', () => {
  it('picks the parser by extension and names the shape from the file', () => {
    const def = importPolyhedron('Big Cube (v2).JSON', JSON.stringify(cube))
    expect(def.name).toBe('cube') // the JSON's own name wins
    expect(importPolyhedron('Big Cube (v2).json', JSON.stringify({ ...cube, name: '' })).name).toBe(
      'big-cube-v2',
    )
    expectError(() => importPolyhedron('shape.stl', ''), /unsupported file type ".stl"/)
  })
})
