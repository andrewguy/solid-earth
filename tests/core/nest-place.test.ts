import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { JointOptions } from '@/core/joints'
import { rotatedBounds } from '@/core/nest/convex'
import { type PreparedParts, placePoint, prepareParts, referenceOutline } from '@/core/nest/parts'
import { FillRule, difference } from 'clipper2-ts'

import { NfpCache, rectIfp } from '@/core/nest/nfp'
import {
  NFP_GROWTH_MM,
  type PlacementResult,
  type Placed,
  Placer,
  fitness,
  leftmostVertex,
  placeParts,
  placedPolygon,
  toLayout,
} from '@/core/nest/place'
import { DEFAULT_NEST_SETTINGS, type NestSettings } from '@/core/nest/types'
import { type PanelShape, panelShapes } from '@/core/panel-shape'
import { longestEdge } from '@/core/pipeline'
import { SCALE, ringArea } from '@/core/planar/clipper'
import { buildFrames } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import { type Vec2, type Vec3, normalize } from '@/core/vec3'

const NORTH: Vec3 = normalize([0.3, -0.2, 0.9])
const FINGER: JointOptions = { kind: 'finger', widthMm: 10, tip: 'fill', clearanceMm: 0.1 }

function setup(
  shape: PresetId,
  nest: NestSettings,
  opts: { joint?: JointOptions; edgeMm?: number; kerfMm?: number } = {},
) {
  const frames = buildFrames(preset(shape))
  const panels = panelShapes(frames, {
    mmPerUnit: (opts.edgeMm ?? 100) / longestEdge(frames),
    thicknessMm: 3,
    joint: opts.joint,
    kerfMm: opts.kerfMm ?? 0,
    north: NORTH,
  })
  const prep = prepareParts(panels, nest)
  return { panels, prep, placer: new Placer(prep) }
}

/** Area of the intersection of two convex CCW polygons (Sutherland–Hodgman). */
function overlapArea(a: readonly Vec2[], b: readonly Vec2[]): number {
  let out: Vec2[] = [...a]
  b.forEach((p, k) => {
    const q = b[(k + 1) % b.length]!
    const side = ([x, y]: Vec2) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    const input = out
    out = []
    input.forEach((s, i) => {
      const e = input[(i + 1) % input.length]!
      const ds = side(s)
      const de = side(e)
      if (ds > 0) out.push(s)
      if (ds > 0 !== de > 0) {
        const r = ds / (ds - de)
        out.push([s[0] + r * (e[0] - s[0]), s[1] + r * (e[1] - s[1])])
      }
    })
  })
  return out.length >= 3 ? Math.abs(ringArea(out)) : 0
}

/** Distance from p to segment ab. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const [ex, ey] = [b[0] - a[0], b[1] - a[1]]
  const u = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)),
  )
  return Math.hypot(p[0] - a[0] - u * ex, p[1] - a[1] - u * ey)
}

/**
 * Distance between two disjoint polygons (convex or not): the closest pair always includes a
 * vertex of one of them.
 */
function polygonDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  let d = Infinity
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const v of p) {
      q.forEach((s, k) => {
        d = Math.min(d, segmentDistance(v, s, q[(k + 1) % q.length]!))
      })
    }
  }
  return d
}

const bounds = (poly: readonly Vec2[]) => rotatedBounds(poly, 0)

/** Check everything a placement must guarantee (plan §13.4 step 5). */
function checkPlacement(
  panels: readonly PanelShape[],
  prep: PreparedParts,
  nest: NestSettings,
  result: ReturnType<typeof placeParts>,
) {
  // Every part exactly once, no empty sheets.
  const seen = result.sheets.flat().map((p) => p.part)
  expect([...seen].sort((a, b) => a - b)).toEqual(prep.parts.map((_, i) => i))
  for (const s of result.sheets) expect(s.length).toBeGreaterThan(0)
  expect(Math.floor(result.fitness)).toBe(result.sheets.length)

  // Padded polygons: inside the bin, and pairwise disjoint on each sheet.
  const { bin } = prep
  for (const sheet of result.sheets) {
    const polys = sheet.map((p) => placedPolygon(prep, p) as Vec2[])
    for (const poly of polys) {
      const b = bounds(poly)
      expect(b.minX).toBeGreaterThanOrEqual(bin.minX - 1e-9)
      expect(b.minY).toBeGreaterThanOrEqual(bin.minY - 1e-9)
      expect(b.maxX).toBeLessThanOrEqual(bin.maxX + 1e-9)
      expect(b.maxY).toBeLessThanOrEqual(bin.maxY + 1e-9)
    }
    polys.forEach((a, i) => {
      for (const b of polys.slice(i + 1)) expect(overlapArea(a, b)).toBe(0)
    })
  }

  // The real cut paths, through the saved layout: margin to the sheet edge, gap between parts.
  const layout = toLayout(prep, result, 'key')
  expect(layout.sheetCount).toBe(result.sheets.length)
  expect(layout.unplaced).toEqual(prep.unplaced)
  const panelOf = new Map(panels.map((p) => [p.faceIndex, p]))
  const cuts = layout.placements.map((pl) => ({
    sheet: pl.sheet,
    path: referenceOutline(panelOf.get(pl.face)!, nest.rotationMode).map((p) => placePoint(p, pl)),
  }))
  for (const { path } of cuts) {
    const b = bounds(path)
    const m = nest.marginMm - 1e-6
    expect(b.minX).toBeGreaterThanOrEqual(m)
    expect(b.minY).toBeGreaterThanOrEqual(m)
    expect(b.maxX).toBeLessThanOrEqual(nest.sheetWidthMm - m)
    expect(b.maxY).toBeLessThanOrEqual(nest.sheetHeightMm - m)
  }
  cuts.forEach((a, i) => {
    const ba = bounds(a.path)
    for (const b of cuts.slice(i + 1)) {
      if (a.sheet !== b.sheet) continue
      const bb = bounds(b.path)
      const apart = Math.max(
        bb.minX - ba.maxX,
        ba.minX - bb.maxX,
        bb.minY - ba.maxY,
        ba.minY - bb.maxY,
      )
      if (apart >= nest.gapMm) continue
      expect(polygonDistance(a.path, b.path)).toBeGreaterThanOrEqual(nest.gapMm - 1e-6)
    }
  })
}

/** A random permutation and angle choice for the parts. */
const arrangement = (prep: PreparedParts) =>
  fc.record({
    order: fc.shuffledSubarray(
      prep.parts.map((_, i) => i),
      { minLength: prep.parts.length, maxLength: prep.parts.length },
    ),
    angles: fc.tuple(...prep.parts.map((p) => fc.nat(p.angles.length - 1))),
  })

describe('placeParts', () => {
  const CASES: { shape: PresetId; joint?: JointOptions; nest: Partial<NestSettings> }[] = [
    { shape: 'icosahedron', nest: { sheetWidthMm: 300, sheetHeightMm: 200 } },
    { shape: 'cube', joint: FINGER, nest: { rotationMode: '90' } },
    {
      shape: 'truncated-icosahedron',
      joint: FINGER,
      nest: { sheetWidthMm: 400, sheetHeightMm: 300 },
    },
    { shape: 'rhombic-triacontahedron', nest: { rotationMode: 'none', gapMm: 4, marginMm: 1 } },
    { shape: 'snub-cube', nest: { rotationMode: '180', sheetWidthMm: 297, sheetHeightMm: 210 } },
  ]

  it.each(CASES)(
    'places $shape validly in any order and orientation ($nest)',
    ({ shape, joint, nest: patch }) => {
      const nest = { ...DEFAULT_NEST_SETTINGS, ...patch }
      const { panels, prep, placer } = setup(shape, nest, { joint, edgeMm: 60, kerfMm: 0.15 })
      expect(prep.unplaced).toEqual([])
      fc.assert(
        fc.property(arrangement(prep), ({ order, angles }) => {
          checkPlacement(panels, prep, nest, placer.place(order, angles))
        }),
        { numRuns: 8 },
      )
    },
  )

  it('keeps parts in the bin when Clipper rounds a vertex just outside the window', () => {
    // Regression (found by the property test above): a rounded intersection vertex one unit
    // below the window put a padded part 0.00057 mm outside the bin.
    const nest = { ...DEFAULT_NEST_SETTINGS, rotationMode: 'none' as const, gapMm: 4, marginMm: 1 }
    const { panels, prep, placer } = setup('rhombic-triacontahedron', nest, {
      edgeMm: 60,
      kerfMm: 0.15,
    })
    const order = [
      13, 17, 0, 20, 21, 27, 7, 4, 18, 3, 15, 24, 28, 12, 11, 6, 1, 10, 29, 9, 19, 22, 2, 5, 14, 16,
      23, 8, 25, 26,
    ]
    checkPlacement(
      panels,
      prep,
      nest,
      placer.place(
        order,
        order.map(() => 0),
      ),
    )
  })

  it('is deterministic', () => {
    const nest = { ...DEFAULT_NEST_SETTINGS, sheetWidthMm: 400, sheetHeightMm: 300 }
    const { prep } = setup('truncated-icosahedron', nest, { edgeMm: 60 })
    const order = prep.parts.map((_, i) => i).reverse()
    const angles = prep.parts.map((p, i) => i % p.angles.length)
    const a = placeParts(prep, order, angles)
    const b = placeParts(prep, order, angles)
    expect(b).toEqual(a)
  })

  it('packs cube squares into a grid, opening a second sheet only when needed', () => {
    // 94 mm squares (100 mm edge, 3 mm butt insets), padded to 96.03 mm with a 2 mm gap.
    // The bin is the sheet minus 2 × (5 − 1) = 8 mm; neighbours sit a further 7 µm apart.
    const order = [0, 1, 2, 3, 4, 5]
    const angles = [0, 0, 0, 0, 0, 0]
    const fits = { ...DEFAULT_NEST_SETTINGS, sheetWidthMm: 296.2, sheetHeightMm: 200.2 }
    const one = setup('cube', fits)
    const r1 = one.placer.place(order, angles)
    checkPlacement(one.panels, one.prep, fits, r1)
    expect(r1.sheets).toHaveLength(1)
    expect(r1.usedWidths[0]).toBeCloseTo(3 * 96.03, 1)

    // 1 mm narrower: only two columns fit, so 4 + 2, with both leftovers in the first column.
    const tight = { ...fits, sheetWidthMm: 295.2 }
    const two = setup('cube', tight)
    const r2 = two.placer.place(order, angles)
    checkPlacement(two.panels, two.prep, tight, r2)
    expect(r2.sheets.map((s) => s.length)).toEqual([4, 2])
    expect(r2.usedWidths[1]).toBeCloseTo(96.03, 2)
    const xs = r2.sheets[1]!.map((p) => bounds(placedPolygon(two.prep, p) as Vec2[]).minX)
    for (const x of xs) expect(x).toBeCloseTo(two.prep.bin.minX, 3)
  })

  it('interlocks alternating triangles in a single strip', () => {
    const probe = setup('icosahedron', { ...DEFAULT_NEST_SETTINGS, rotationStepDeg: 1 })
    const part = probe.prep.parts[0]!
    const poly = probe.prep.shapes[part.shape]!.polygon
    // The orientation with a flat edge at the bottom (smallest height), and the same flipped.
    const height = (a: number) => {
      const b = rotatedBounds(poly, a)
      return b.maxY - b.minY
    }
    const flat = part.angles.reduce((best, a) => (height(a.alpha) < height(best.alpha) ? a : best))
    const side = rotatedBounds(poly, flat.alpha).maxX - rotatedBounds(poly, flat.alpha).minX
    // A strip just tall enough for one row.
    const nest = {
      ...DEFAULT_NEST_SETTINGS,
      rotationStepDeg: 1,
      sheetWidthMm: 2000,
      sheetHeightMm: height(flat.alpha) + 8 + 0.5,
    }
    const { panels, prep, placer } = setup('icosahedron', nest)
    const angles = prep.parts.map((p, i) => {
      const want = (flat.alpha + (i % 2) * (Math.PI / 3)) % ((2 * Math.PI) / 3)
      return p.angles.findIndex((a) => Math.abs(a.alpha - want) < 1e-9)
    })
    expect(angles.every((a) => a >= 0)).toBe(true)
    const result = placer.place(
      prep.parts.map((_, i) => i),
      angles,
    )
    checkPlacement(panels, prep, nest, result)
    expect(result.sheets).toHaveLength(1)
    // Twenty alternating triangles in a row span about 10.5 sides (the 1° grid needn't hold an
    // exactly flat orientation); without interlocking they would need about 20.
    expect(result.usedWidths[0]! / side).toBeGreaterThan(10.3)
    expect(result.usedWidths[0]! / side).toBeLessThan(10.7)
  })
})

/**
 * The plain algorithm, without the placer's speed-ups (left window, obstacle filtering, full-sheet
 * memo): every sheet in turn, the whole IFP minus every NFP.
 */
function naivePlace(prep: PreparedParts, order: number[], angles: number[]): PlacementResult {
  const cache = new NfpCache(prep.shapes, NFP_GROWTH_MM)
  const sheets: Placed[][] = []
  const usedWidths: number[] = []
  for (const index of order) {
    const part = prep.parts[index]!
    const beta = part.angles[angles[index]!]!.alpha
    const poly = prep.shapes[part.shape]!.polygon
    const ifp = rectIfp(prep.bin, poly, beta)!
    const x0 = Math.ceil(ifp.minX * SCALE)
    const y0 = Math.ceil(ifp.minY * SCALE)
    const x1 = Math.max(Math.floor(ifp.maxX * SCALE), x0 + 1)
    const y1 = Math.max(Math.floor(ifp.maxY * SCALE), y0 + 1)
    const rect = [
      [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    ]
    let placed: Placed | null = null
    let sheet = 0
    for (; sheet < sheets.length && !placed; sheet++) {
      const nfps = sheets[sheet]!.map((p) => {
        const o = prep.parts[p.part]!
        return cache
          .get(o.shape, o.angles[p.angle]!.alpha, part.shape, beta)
          .map(([x, y]) => ({ x: Math.round((x + p.x) * SCALE), y: Math.round((y + p.y) * SCALE) }))
      })
      const best = leftmostVertex(difference(rect, nfps, FillRule.NonZero), x0, y0, x1, y1)
      if (best)
        placed = { part: index, angle: angles[index]!, x: best.x / SCALE, y: best.y / SCALE }
    }
    if (placed) sheet--
    else {
      sheets.push([])
      usedWidths.push(0)
      sheet = sheets.length - 1
      placed = { part: index, angle: angles[index]!, x: x0 / SCALE, y: y0 / SCALE }
    }
    sheets[sheet]!.push(placed)
    const b = rotatedBounds(poly, beta)
    usedWidths[sheet] = Math.max(usedWidths[sheet]!, b.maxX + placed.x - prep.bin.minX)
  }
  return { sheets, usedWidths, fitness: fitness(usedWidths, prep.bin.maxX - prep.bin.minX) }
}

describe('Placer speed-ups', () => {
  it.each<[PresetId, Partial<NestSettings>]>([
    ['truncated-icosahedron', { sheetWidthMm: 300, sheetHeightMm: 200 }],
    ['snub-cube', { rotationMode: '90', sheetWidthMm: 297, sheetHeightMm: 210 }],
  ])("give exactly the plain algorithm's result (%s)", (shape, patch) => {
    const nest = { ...DEFAULT_NEST_SETTINGS, ...patch }
    const { prep, placer } = setup(shape, nest, { joint: FINGER, edgeMm: 60 })
    fc.assert(
      fc.property(arrangement(prep), ({ order, angles }) => {
        expect(placer.place(order, angles)).toEqual(naivePlace(prep, order, [...angles]))
      }),
      { numRuns: 6 },
    )
  })
})

describe('fitness', () => {
  it('always prefers fewer sheets, then a narrower last sheet', () => {
    expect(fitness([], 100)).toBe(0)
    expect(fitness([100, 100], 100)).toBeLessThan(fitness([100, 100, 1], 100))
    expect(fitness([100, 30], 100)).toBeLessThan(fitness([100, 40], 100))
    expect(fitness([90, 40], 100)).toBeLessThan(fitness([100, 40], 100))
    // The last sheet matters most.
    expect(fitness([100, 30], 100)).toBeLessThan(fitness([50, 40], 100))
    expect(Math.floor(fitness([100, 100, 100], 100))).toBe(3)
  })
})
