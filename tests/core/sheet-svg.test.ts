import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SVG_OPTIONS,
  SHEET_OUTLINE_COLOR,
  faceToSvg,
  sheetSvgs,
  sheetToSvg,
} from '@/core/export/svg'
import { prepareLines } from '@/core/geo/lines'
import { type LandTopology, coastlineLines } from '@/core/geo/topojson'
import { DEFAULT_LAYER_STYLES, LIGHTBURN_PALETTE } from '@/core/layers'
import type { NestLayout, NestSettings } from '@/core/nest/types'
import { DEFAULT_NEST_SETTINGS, ROTATION_MODES } from '@/core/nest/types'
import { placePoint, referenceOutline } from '@/core/nest/parts'
import { panelShapes } from '@/core/panel-shape'
import { buildAllFaces, longestEdge, prepareMap } from '@/core/pipeline'
import { buildFrames } from '@/core/polyhedron/faces'
import { fromAxisAngle, rotate } from '@/core/quat'
import { DEFAULT_SETTINGS, type ProjectSettings, jointOptions } from '@/core/settings'
import type { Vec2 } from '@/core/vec3'
import land110m from '@/data/land-110m.topo.json'
import { nestRequest, runNest } from '@/worker/nester'

const map = prepareMap({
  coastlines: prepareLines(coastlineLines(land110m as unknown as LandTopology)),
})
const styles = DEFAULT_LAYER_STYLES
const options = { strokeMm: 0.1, styles, outline: true }

/** A project, its face artwork (as the projector would build it) and a nested layout. */
function scenario(patch: Partial<NestSettings> = {}, joint: ProjectSettings['joint'] = 'finger') {
  const settings: ProjectSettings = {
    ...DEFAULT_SETTINGS,
    edgeLengthMm: 60,
    joint,
    kerfEnabled: true,
    rotation: fromAxisAngle([1, 2, 3], 0.7),
    nest: {
      ...DEFAULT_NEST_SETTINGS,
      sheetWidthMm: 300,
      sheetHeightMm: 200,
      generations: 2,
      population: 3,
      ...patch,
    },
  }
  const frames = buildFrames(settings.polyhedron)
  const arts = buildAllFaces(frames, map, {
    mmPerUnit: settings.edgeLengthMm / longestEdge(frames),
    precisionMm: 0.01,
    thicknessMm: settings.thicknessMm,
    kerfMm: settings.kerfMm,
    joint: jointOptions(settings),
    north: rotate(settings.rotation, [0, 0, 1]),
  })
  const { layout } = runNest(nestRequest(settings))
  // The panels exactly as the nester saw them.
  const panels = panelShapes(frames, {
    mmPerUnit: settings.edgeLengthMm / longestEdge(frames),
    thicknessMm: settings.thicknessMm,
    kerfMm: settings.kerfMm,
    joint: jointOptions(settings),
    north: rotate(settings.rotation, [0, 0, 1]),
  })
  return { settings, arts, layout, panels }
}

/** Layer groups of an SVG: id → inner markup. */
function groups(svg: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of svg.matchAll(/<g id="layer-([a-z]+)"[^>]*>([\s\S]*?)<\/g>/g)) {
    expect(out.has(m[1]!)).toBe(false) // one group per layer
    out.set(m[1]!, m[2]!)
  }
  return out
}

/** Every subpath (M…) of every path in some markup, as points. */
function subpaths(markup: string | undefined): Vec2[][] {
  if (!markup) return []
  return [...markup.matchAll(/ d="([^"]+)"/g)].flatMap((m) =>
    m[1]!
      .split('M')
      .filter(Boolean)
      .map((sp) =>
        sp
          .replace('Z', '')
          .split('L')
          .map((pt) => pt.split(' ').map(Number) as unknown as Vec2),
      ),
  )
}

const signedArea = (r: readonly Vec2[]) =>
  r.reduce((a, [x0, y0], i) => {
    const [x1, y1] = r[(i + 1) % r.length]!
    return a + x0 * y1 - x1 * y0
  }, 0) / 2

const edgeLengths = (r: readonly Vec2[]) =>
  r.map((p, i) => {
    const q = r[(i + 1) % r.length]!
    return Math.hypot(q[0] - p[0], q[1] - p[1])
  })

const faceSvg = (art: Parameters<typeof faceToSvg>[0]) =>
  faceToSvg(art, { ...DEFAULT_SVG_OPTIONS, styles })

/** Placements on a sheet, in the order their paths are written. */
const onSheet = (layout: NestLayout, sheet: number) =>
  layout.placements.filter((p) => p.sheet === sheet)

describe('sheetToSvg', () => {
  const { settings, arts, layout } = scenario()
  const { nest } = settings
  const svgs = sheetSvgs(arts, layout, nest, options)

  it('writes one true-scale document per sheet, with the outline on the T1 tool layer', () => {
    expect(layout.sheetCount).toBeGreaterThan(0)
    expect(svgs).toHaveLength(layout.sheetCount)
    for (const svg of svgs) {
      expect(svg).toContain('width="300mm" height="200mm" viewBox="0 0 300 200"')
      const g = groups(svg)
      expect([...g.keys()][0]).toBe('sheet') // drawn first, under everything
      expect(g.get('sheet')).toContain(`stroke="${SHEET_OUTLINE_COLOR}"`)
      expect(subpaths(g.get('sheet'))).toEqual([
        [
          [0, 0],
          [300, 0],
          [300, 200],
          [0, 200],
        ],
      ])
      expect(g.has('cut')).toBe(true)
      expect(g.has('coastlines')).toBe(true)
    }
    // T1 is not an output palette colour, so it can never be mistaken for a cut layer.
    expect(LIGHTBURN_PALETTE as readonly string[]).not.toContain(SHEET_OUTLINE_COLOR)
    expect(
      groups(sheetToSvg(arts, layout, 0, nest, { ...options, outline: false })).has('sheet'),
    ).toBe(false)
  })

  it('keeps every cut path inside the sheet margin', () => {
    const tol = 0.011 // 0.01 mm output grid
    svgs.forEach((svg, sheet) => {
      const cuts = subpaths(groups(svg).get('cut'))
      expect(cuts).toHaveLength(onSheet(layout, sheet).length)
      for (const [x, y] of cuts.flat()) {
        expect(x).toBeGreaterThanOrEqual(nest.marginMm - tol)
        expect(y).toBeGreaterThanOrEqual(nest.marginMm - tol)
        expect(x).toBeLessThanOrEqual(nest.sheetWidthMm - nest.marginMm + tol)
        expect(y).toBeLessThanOrEqual(nest.sheetHeightMm - nest.marginMm + tol)
      }
    })
  })

  it('places each panel by a rigid motion of its face SVG, never mirrored', () => {
    svgs.forEach((svg, sheet) => {
      const cuts = subpaths(groups(svg).get('cut'))
      onSheet(layout, sheet).forEach((p, i) => {
        const [own] = subpaths(groups(faceSvg(arts[p.face]!)).get('cut'))
        const placed = cuts[i]!
        expect(placed).toHaveLength(own!.length)
        edgeLengths(placed).forEach((l, k) => expect(l).toBeCloseTo(edgeLengths(own!)[k]!, 1))
        expect(signedArea(placed)).toBeCloseTo(signedArea(own!), 0)
        expect(Math.sign(signedArea(placed))).toBe(Math.sign(signedArea(own!)))
      })
    })
  })

  it('carries all the linework of every placed panel, and nothing of unplaced ones', () => {
    const count = (svg: string) => subpaths(groups(svg).get('coastlines')).length
    const onSheets = svgs.reduce((n, svg) => n + count(svg), 0)
    const own = layout.placements.reduce((n, p) => n + count(faceSvg(arts[p.face]!)), 0)
    expect(onSheets).toBe(own)

    // Drop one placement: its cut path disappears from the sheet.
    const [first, ...rest] = layout.placements
    const fewer: NestLayout = { ...layout, placements: rest, unplaced: [first!.face] }
    const cuts = (l: NestLayout) =>
      subpaths(groups(sheetToSvg(arts, l, first!.sheet, nest, options)).get('cut'))
    expect(cuts(fewer)).toHaveLength(cuts(layout).length - 1)
  })
})

describe('sheetToSvg in "none" rotation mode', () => {
  it('translates each panel exactly as its face SVG shows it (north-up, unrotated)', () => {
    const { settings, arts, layout } = scenario({ rotationMode: 'none' }, 'butt')
    const svgs = sheetSvgs(arts, layout, settings.nest, options)
    svgs.forEach((svg, sheet) => {
      const cuts = subpaths(groups(svg).get('cut'))
      onSheet(layout, sheet).forEach((p, i) => {
        const [own] = subpaths(groups(faceSvg(arts[p.face]!)).get('cut'))
        const placed = cuts[i]!
        const dx = placed[0]![0] - own![0]![0]
        const dy = placed[0]![1] - own![0]![1]
        placed.forEach(([x, y], k) => {
          expect(x - own![k]![0]).toBeCloseTo(dx, 1)
          expect(y - own![k]![1]).toBeCloseTo(dy, 1)
        })
      })
    })
  })
})

describe('sheetToSvg geometry', () => {
  it.each(ROTATION_MODES)(
    'draws every cut path exactly where the nester placed it (%s)',
    (rotationMode) => {
      const { settings, arts, layout, panels } = scenario({ rotationMode })
      const { nest } = settings
      sheetSvgs(arts, layout, nest, options).forEach((svg, sheet) => {
        const cuts = subpaths(groups(svg).get('cut'))
        onSheet(layout, sheet).forEach((p, i) => {
          const expected = referenceOutline(panels[p.face]!, rotationMode).map((q) => {
            const [x, y] = placePoint(q, p)
            return [x, nest.sheetHeightMm - y] as const // SVG is y-down
          })
          const drawn = cuts[i]!
          expect(drawn).toHaveLength(expected.length)
          // Artwork is rounded to 0.01 mm before placing, and the SVG to 0.01 mm after.
          drawn.forEach(([x, y], k) => {
            expect(Math.hypot(x - expected[k]![0], y - expected[k]![1])).toBeLessThan(0.02)
          })
        })
      })
    },
  )
})
