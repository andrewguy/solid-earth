import { describe, expect, it } from 'vitest'

import { rotatedBounds } from '@/core/nest/convex'
import { greedyIndividual, mulberry32, optimise } from '@/core/nest/optimise'
import { type PreparedParts, prepareParts } from '@/core/nest/parts'
import { Placer } from '@/core/nest/place'
import { DEFAULT_NEST_SETTINGS, type NestSettings } from '@/core/nest/types'
import { type PanelShape, panelShapes } from '@/core/panel-shape'
import { longestEdge } from '@/core/pipeline'
import { buildFrames } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import type { Vec2 } from '@/core/vec3'

function polyhedronPrep(shape: PresetId, nest: NestSettings, edgeMm = 60): PreparedParts {
  const frames = buildFrames(preset(shape))
  const panels = panelShapes(frames, { mmPerUnit: edgeMm / longestEdge(frames), thicknessMm: 3 })
  return prepareParts(panels, nest)
}

/** A synthetic axis-aligned rectangular panel. */
const rectPanel = (faceIndex: number, w: number, h: number): PanelShape => {
  const outline: Vec2[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]
  return { faceIndex, outline, cutOutline: outline, rotation: 0 }
}

const expectComplete = (prep: PreparedParts, sheets: readonly (readonly { part: number }[])[]) =>
  expect(
    sheets
      .flat()
      .map((p) => p.part)
      .sort((a, b) => a - b),
  ).toEqual(prep.parts.map((_, i) => i))

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const xs = Array.from({ length: 1000 }, () => a())
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs)
    expect(c()).not.toBe(xs[0])
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('greedyIndividual', () => {
  it('orders largest shapes first and picks the smallest, then narrowest, bounding box', () => {
    const prep = polyhedronPrep('truncated-icosahedron', DEFAULT_NEST_SETTINGS)
    const { order, angles } = greedyIndividual(prep)
    const areas = order.map((i) => prep.shapes[prep.parts[i]!.shape]!.area)
    for (let k = 1; k < areas.length; k++) expect(areas[k]).toBeLessThanOrEqual(areas[k - 1]!)
    prep.parts.forEach((part, i) => {
      const poly = prep.shapes[part.shape]!.polygon
      const box = (a: number) => {
        const b = rotatedBounds(poly, part.angles[a]!.alpha)
        return (b.maxX - b.minX) * (b.maxY - b.minY)
      }
      for (let a = 0; a < part.angles.length; a++) {
        expect(box(angles[i]!)).toBeLessThanOrEqual(box(a) + 1e-6)
      }
    })
  })
})

describe('optimise', () => {
  const nest = { ...DEFAULT_NEST_SETTINGS, sheetWidthMm: 300, sheetHeightMm: 200 }

  it('is never worse than the greedy start, and places every part', () => {
    for (const shape of ['icosahedron', 'truncated-icosahedron', 'snub-cube'] as const) {
      const prep = polyhedronPrep(shape, nest)
      const placer = new Placer(prep)
      const g = greedyIndividual(prep)
      const greedy = placer.place(g.order, g.angles)
      const r = optimise(placer, { generations: 4, population: 6, seed: 7 })
      expect(r.best.fitness).toBeLessThanOrEqual(greedy.fitness)
      expectComplete(prep, r.best.sheets)
      // The reported individual reproduces the reported result.
      expect(placer.place(r.individual.order, r.individual.angles)).toEqual(r.best)
    }
  })

  it('gives identical results for the same input and seed', () => {
    const prep = polyhedronPrep('truncated-icosahedron', nest)
    const run = () => optimise(new Placer(prep), { generations: 3, population: 5, seed: 11 })
    expect(run()).toEqual(run())
  })

  it('reports progress each generation and can stop early', () => {
    const prep = polyhedronPrep('icosahedron', nest)
    const seen: number[] = []
    let last = Infinity
    const r = optimise(new Placer(prep), {
      generations: 10,
      population: 4,
      seed: 1,
      onProgress: (p) => {
        expect(p.generations).toBe(10)
        expect(p.best.fitness).toBeLessThanOrEqual(last) // the best never gets worse
        last = p.best.fitness
        seen.push(p.generation)
      },
      shouldStop: () => seen.length >= 3,
    })
    expect(seen).toEqual([1, 2, 3])
    expect(r.generations).toBe(3)
    expect(r.best.fitness).toBe(last)
  })

  it('finds a one-sheet layout where the greedy start needs two', () => {
    // Three 100 × 50 rectangles on a 101 × 152 sheet, no gap or margin. Greedy stands them all
    // upright (same area, narrower), and only two fit side by side. Lying any one of them flat
    // fits all three on one sheet.
    const rects = [0, 1, 2].map((i) => rectPanel(i, 100, 50))
    const settings: NestSettings = {
      ...DEFAULT_NEST_SETTINGS,
      sheetWidthMm: 101,
      sheetHeightMm: 152,
      gapMm: 0,
      marginMm: 0,
      rotationMode: 'free',
      rotationStepDeg: 90,
    }
    const prep = prepareParts(rects, settings)
    expect(prep.shapes).toHaveLength(1)
    expect(prep.parts[0]!.angles).toHaveLength(2) // 0° and 90°; 180° is the same rectangle
    const placer = new Placer(prep)
    const g = greedyIndividual(prep)
    expect(placer.place(g.order, g.angles).sheets).toHaveLength(2)
    const r = optimise(placer, { generations: 10, population: 8, seed: 3 })
    expect(r.best.sheets).toHaveLength(1)
    expectComplete(prep, r.best.sheets)
  })
})
