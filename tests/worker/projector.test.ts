import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'

import { PROJECT_SCHEMA_VERSION, serializeProject } from '@/core/export/project-file'
import { buildFacesZip, faceFileName, sheetFileName, zipFileName } from '@/core/export/zip'
import { DEFAULT_LAYER_STYLES } from '@/core/layers'
import { DEFAULT_NEST_SETTINGS } from '@/core/nest/types'
import { icosahedron, preset } from '@/core/polyhedron/presets'
import { IDENTITY } from '@/core/quat'
import { DEFAULT_SETTINGS, type ProjectSettings, jointOptions } from '@/core/settings'
import countries110m from '@/data/countries-110m.topo.json'
import countries50m from '@/data/countries-50m.topo.json'
import land110m from '@/data/land-110m.topo.json'
import lakes110m from '@/data/lakes-110m.topo.json'
import lakes50m from '@/data/lakes-50m.topo.json'
import land50m from '@/data/land-50m.topo.json'
import rivers110m from '@/data/rivers-110m.topo.json'
import rivers50m from '@/data/rivers-50m.topo.json'
import { nestRequest, runNest } from '@/worker/nester'
import { type DataLoader, type MapSources, Projector, transferables } from '@/worker/projector'

const data = {
  '110m': { land: land110m, countries: countries110m, lakes: lakes110m, rivers: rivers110m },
  '50m': { land: land50m, countries: countries50m, lakes: lakes50m, rivers: rivers50m },
} as unknown as Record<'110m' | '50m', MapSources>

const load: DataLoader = (r) => Promise.resolve(data[r])

const request = {
  polyhedron: { id: 'icosahedron', def: icosahedron() },
  resolution: '50m' as const,
  edgeLengthMm: 100,
  rotation: IDENTITY,
  layerStyles: DEFAULT_LAYER_STYLES,
  graticuleIntervalDeg: 15,
}

describe('Projector', () => {
  it('projects all 20 icosahedron faces at 50m within the performance budget', async () => {
    const projector = new Projector(load)
    const result = await projector.project(request)
    expect(result.shape).toBe('icosahedron')
    expect(result.svgs).toHaveLength(20)
    for (const svg of result.svgs!) expect(svg).toMatch(/^<\?xml[\s\S]*<\/svg>\n$/)
    // Plan §9: < 2 s for 32 truncated-icosahedron faces at 50m; 20 faces here.
    expect(result.projectMs).toBeLessThan(2000)
    console.log(
      `50m: prepare ${result.prepareMs.toFixed(0)} ms, project ${result.projectMs.toFixed(0)} ms`,
    )
  })

  it('projects all 32 truncated-icosahedron faces at 50m in < 2 s (plan §9)', async () => {
    const projector = new Projector(load)
    const result = await projector.project({
      ...request,
      polyhedron: { id: 'truncated-icosahedron', def: preset('truncated-icosahedron') },
    })
    expect(result.shape).toBe('truncated-icosahedron')
    expect(result.svgs).toHaveLength(32)
    expect(result.projectMs).toBeLessThan(2000)
    console.log(`truncated icosahedron 50m: project ${result.projectMs.toFixed(0)} ms`)
  })

  it('everything on (fills, rivers, graticule): 32 faces at 50m in < 2 s (plan §9)', async () => {
    const all = Object.fromEntries(
      Object.entries(DEFAULT_LAYER_STYLES).map(([id, st]) => [id, { ...st, enabled: true }]),
    ) as typeof DEFAULT_LAYER_STYLES
    const projector = new Projector(load)
    const result = await projector.project({
      ...request,
      layerStyles: all,
      polyhedron: { id: 'truncated-icosahedron', def: preset('truncated-icosahedron') },
    })
    console.log(
      `all layers, truncated icosahedron 50m: prepare ${result.prepareMs.toFixed(0)} ms, project ${result.projectMs.toFixed(0)} ms`,
    )
    expect(result.projectMs).toBeLessThan(2000)
    for (const svg of result.svgs!) expect(svg).toContain('</svg>')
    expect(result.svgs!.filter((s) => s.includes('layer-ocean'))).toHaveLength(32)
    expect(result.svgs!.some((s) => s.includes('layer-land'))).toBe(true)
    expect(result.svgs!.some((s) => s.includes('layer-lakes'))).toBe(true)
    expect(result.svgs!.some((s) => s.includes('layer-rivers'))).toBe(true)
    expect(result.svgs!.filter((s) => s.includes('layer-graticule'))).toHaveLength(32)
  })

  it('50m output is much more detailed than 110m', async () => {
    const projector = new Projector(load)
    const coarse = await projector.project({ ...request, resolution: '110m' })
    const fine = await projector.project(request)
    const size = (svgs: string[] | null) => svgs!.reduce((n, s) => n + s.length, 0)
    expect(size(fine.svgs)).toBeGreaterThan(3 * size(coarse.svgs))
  })

  it('loads each resolution once and re-serialises from cache on style changes', async () => {
    const spy = vi.fn<DataLoader>(load)
    const projector = new Projector(spy)
    await projector.project(request)
    const restyled = await projector.project({
      ...request,
      layerStyles: {
        ...DEFAULT_LAYER_STYLES,
        borders: { ...DEFAULT_LAYER_STYLES.borders, enabled: false },
      },
    })
    expect(restyled.projectMs).toBe(0)
    expect(restyled.svgs!.some((s) => s.includes('layer-borders'))).toBe(false)
    await projector.project({ ...request, edgeLengthMm: 150 })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('preview mode returns packed artwork only, matching the full result', async () => {
    const projector = new Projector(load)
    const full = await projector.project({ ...request, resolution: '110m' })
    const preview = await projector.project({ ...request, resolution: '110m', wantSvg: false })
    expect(preview.svgs).toBeNull()
    expect(preview.faces).toHaveLength(20)
    expect(preview.mmPerUnit).toBeCloseTo(100, 12)
    // Same polylines; preview is unrounded, full is rounded to 0.01 mm.
    full.faces.forEach((f, i) => {
      const a = f.lines.coastlines!
      const b = preview.faces[i]!.lines.coastlines!
      expect(b.starts.length).toBe(a.starts.length)
      expect(b.starts.at(-1)).toBeGreaterThanOrEqual(a.starts.at(-1)!) // rounding may dedupe
    })
    expect(transferables(preview).length).toBeGreaterThan(20)
  })

  it('provides unit-vector line segments for the live GPU preview', async () => {
    const projector = new Projector(load)
    const { lines } = await projector.lineSegments('110m', 15)
    for (const id of ['coastlines', 'borders', 'rivers', 'lakeShores', 'graticule'] as const) {
      const a = lines[id]!
      expect(a.length % 6).toBe(0)
      expect(a.length).toBeGreaterThan(600)
      for (let i = 0; i < a.length; i += 3) {
        expect(Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!)).toBeCloseTo(1, 5)
      }
    }
  })

  it('kerf enlarges only the cut path; engraving is unchanged', async () => {
    const projector = new Projector(load)
    const plain = await projector.project({ ...request, resolution: '110m' })
    const kerfed = await projector.project({ ...request, resolution: '110m', kerfMm: 0.2 })
    const width = (svg: string) => Number(/width="([\d.]+)mm"/.exec(svg)![1])
    const coast = (svg: string) => /<g id="layer-coastlines"[\s\S]*?<\/g>/.exec(svg)?.[0]
    plain.svgs!.forEach((svg, i) => {
      const k = kerfed.svgs![i]!
      expect(width(k)).toBeGreaterThan(width(svg))
      // Same engraving geometry, only shifted by the larger margin box.
      expect(coast(k) === undefined).toBe(coast(svg) === undefined)
    })
    expect(kerfed.projectMs).toBeGreaterThan(0) // kerf is part of the cache key
  })

  it('retries after a failed data load', async () => {
    let calls = 0
    const projector = new Projector((r) =>
      ++calls === 1 ? Promise.reject(new Error('offline')) : load(r),
    )
    await expect(projector.project(request)).rejects.toThrow('offline')
    await expect(projector.project(request)).resolves.toBeTruthy()
  })
})

describe('Projector sheets', () => {
  const settings: ProjectSettings = {
    ...DEFAULT_SETTINGS,
    edgeLengthMm: 100,
    rotation: IDENTITY,
    nest: { ...DEFAULT_NEST_SETTINGS, generations: 2, population: 3 },
  }
  const sheetsRequest = {
    ...request,
    resolution: '110m' as const,
    thicknessMm: settings.thicknessMm,
    joint: jointOptions(settings),
  }
  const layout = runNest(nestRequest(settings)).layout
  const cuts = (svg: string) =>
    (/<g id="layer-cut"[\s\S]*?<\/g>/.exec(svg)?.[0].match(/M/g) ?? []).length

  it('renders one SVG per sheet with every placed panel, and none without a layout', async () => {
    const projector = new Projector(load)
    const r = await projector.project({
      ...sheetsRequest,
      sheets: { layout, nest: settings.nest, outline: true },
    })
    expect(r.sheetSvgs).toHaveLength(layout.sheetCount)
    expect(r.sheetSvgs!.reduce((n, svg) => n + cuts(svg), 0)).toBe(layout.placements.length)
    for (const svg of r.sheetSvgs!) {
      expect(svg).toContain('width="600mm" height="400mm"')
      expect(svg).toContain('layer-sheet')
    }
    expect(r.svgs).toHaveLength(20) // face SVGs as before

    const plain = await projector.project(sheetsRequest)
    expect(plain.sheetSvgs).toBeNull()
    const preview = await projector.project({
      ...sheetsRequest,
      wantSvg: false,
      sheets: { layout, nest: settings.nest, outline: true },
    })
    expect(preview.sheetSvgs).toBeNull()
  })

  it('re-serialises from cached artwork when only the layout or outline changes', async () => {
    const projector = new Projector(load)
    await projector.project(sheetsRequest)
    const other = runNest(nestRequest({ ...settings, nest: { ...settings.nest, seed: 99 } })).layout
    const r = await projector.project({
      ...sheetsRequest,
      sheets: { layout: other, nest: settings.nest, outline: false },
    })
    expect(r.projectMs).toBe(0)
    expect(r.sheetSvgs!.some((svg) => svg.includes('layer-sheet'))).toBe(false)
  })

  it('rejects a layout whose faces are not on this shape', async () => {
    const projector = new Projector(load)
    const bad = {
      ...layout,
      placements: [...layout.placements, { face: 25, sheet: 0, x: 0, y: 0, angleDeg: 0 }],
    }
    await expect(
      projector.project({
        ...sheetsRequest,
        sheets: { layout: bad, nest: settings.nest, outline: true },
      }),
    ).rejects.toThrow(/face 25/)
  })
})

describe('ZIP export', () => {
  const settings: ProjectSettings = {
    preset: 'icosahedron',
    polyhedron: icosahedron(),
    rotation: IDENTITY,
    edgeLengthMm: 100,
    resolution: '50m',
    layerStyles: DEFAULT_LAYER_STYLES,
    graticuleIntervalDeg: 15,
    thicknessMm: 3,
    kerfEnabled: false,
    kerfMm: 0.15,
    joint: 'butt',
    fingerWidthMm: 10,
    fingerTip: 'fill',
    fingerClearanceMm: 0.1,
    bevelAllowanceMm: 0.5,
    subject: 'earth',
    skyFlip: false,
    starMagLimit: 5,
    starMinDiameterMm: 0.6,
    starMaxDiameterMm: 3,
    starHoleMagLimit: 2.5,
    starHoleMinDiameterMm: 1,
    skyGridIntervalDeg: 15,
    craterMinDiameterKm: 30,
    moonGridIntervalDeg: 15,
    nest: DEFAULT_NEST_SETTINGS,
    nestLayout: null,
  }

  it('contains every face SVG plus a versioned project.json', async () => {
    const svgs = Array.from({ length: 20 }, (_, i) => `<svg id="${i}"/>`)
    const bytes = await buildFacesZip('icosahedron', svgs, serializeProject(settings))
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).sort()
    expect(names).toHaveLength(21)
    expect(names).toContain('icosahedron_face-00.svg')
    expect(names).toContain('icosahedron_face-19.svg')
    expect(await zip.file(faceFileName('icosahedron', 7))!.async('string')).toBe('<svg id="7"/>')
    const project = JSON.parse(await zip.file('project.json')!.async('string'))
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(project).toMatchObject(settings)
    expect(zipFileName('icosahedron')).toBe('icosahedron_faces.zip')
  })

  it('adds sheet SVGs numbered from 01', async () => {
    const svgs = Array.from({ length: 20 }, (_, i) => `<svg id="${i}"/>`)
    const sheets = ['<svg id="s0"/>', '<svg id="s1"/>']
    const bytes = await buildFacesZip('icosahedron', svgs, serializeProject(settings), sheets)
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files)).toHaveLength(23)
    expect(sheetFileName('icosahedron', 0)).toBe('icosahedron_sheet-01.svg')
    expect(await zip.file('icosahedron_sheet-02.svg')!.async('string')).toBe('<svg id="s1"/>')
  })
})
