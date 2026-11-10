import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'

import { PROJECT_SCHEMA_VERSION, serializeProject } from '@/core/export/project-file'
import { buildFacesZip, faceFileName, zipFileName } from '@/core/export/zip'
import { DEFAULT_LAYER_STYLES } from '@/core/layers'
import { icosahedron, preset } from '@/core/polyhedron/presets'
import { IDENTITY } from '@/core/quat'
import type { ProjectSettings } from '@/core/settings'
import countries110m from '@/data/countries-110m.topo.json'
import countries50m from '@/data/countries-50m.topo.json'
import land110m from '@/data/land-110m.topo.json'
import land50m from '@/data/land-50m.topo.json'
import { type DataLoader, type MapSources, Projector, transferables } from '@/worker/projector'

const data = {
  '110m': { land: land110m, countries: countries110m },
  '50m': { land: land50m, countries: countries50m },
} as unknown as Record<'110m' | '50m', MapSources>

const request = {
  polyhedron: { id: 'icosahedron', def: icosahedron() },
  resolution: '50m' as const,
  edgeLengthMm: 100,
  rotation: IDENTITY,
  layerStyles: DEFAULT_LAYER_STYLES,
}

describe('Projector', () => {
  it('projects all 20 icosahedron faces at 50m within the performance budget', async () => {
    const projector = new Projector((r) => Promise.resolve(data[r]))
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
    const projector = new Projector((r) => Promise.resolve(data[r]))
    const result = await projector.project({
      ...request,
      polyhedron: { id: 'truncated-icosahedron', def: preset('truncated-icosahedron') },
    })
    expect(result.shape).toBe('truncated-icosahedron')
    expect(result.svgs).toHaveLength(32)
    expect(result.projectMs).toBeLessThan(2000)
    console.log(`truncated icosahedron 50m: project ${result.projectMs.toFixed(0)} ms`)
  })

  it('50m output is much more detailed than 110m', async () => {
    const projector = new Projector((r) => Promise.resolve(data[r]))
    const coarse = await projector.project({ ...request, resolution: '110m' })
    const fine = await projector.project(request)
    const size = (svgs: string[] | null) => svgs!.reduce((n, s) => n + s.length, 0)
    expect(size(fine.svgs)).toBeGreaterThan(3 * size(coarse.svgs))
  })

  it('loads each resolution once and re-serialises from cache on style changes', async () => {
    const load = vi.fn<DataLoader>((r) => Promise.resolve(data[r]))
    const projector = new Projector(load)
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
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('preview mode returns packed artwork only, matching the full result', async () => {
    const projector = new Projector((r) => Promise.resolve(data[r]))
    const full = await projector.project({ ...request, resolution: '110m' })
    const preview = await projector.project({ ...request, resolution: '110m', wantSvg: false })
    expect(preview.svgs).toBeNull()
    expect(preview.faces).toHaveLength(20)
    expect(preview.mmPerUnit).toBeCloseTo(100, 12)
    // Same polylines; preview is unrounded, full is rounded to 0.01 mm.
    full.faces.forEach((f, i) => {
      const a = f.layers.coastlines!
      const b = preview.faces[i]!.layers.coastlines!
      expect(b.starts.length).toBe(a.starts.length)
      expect(b.starts.at(-1)).toBeGreaterThanOrEqual(a.starts.at(-1)!) // rounding may dedupe
    })
    expect(transferables(preview).length).toBeGreaterThan(20)
  })

  it('provides unit-vector line segments for the live GPU preview', async () => {
    const projector = new Projector((r) => Promise.resolve(data[r]))
    const { layers } = await projector.lineSegments('110m')
    for (const id of ['coastlines', 'borders'] as const) {
      const a = layers[id]!
      expect(a.length % 6).toBe(0)
      expect(a.length).toBeGreaterThan(6000)
      for (let i = 0; i < a.length; i += 3) {
        expect(Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!)).toBeCloseTo(1, 5)
      }
    }
  })

  it('retries after a failed data load', async () => {
    let calls = 0
    const projector = new Projector((r) =>
      ++calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(data[r]),
    )
    await expect(projector.project(request)).rejects.toThrow('offline')
    await expect(projector.project(request)).resolves.toBeTruthy()
  })
})

describe('ZIP export', () => {
  const settings: ProjectSettings = {
    polyhedron: icosahedron(),
    rotation: IDENTITY,
    edgeLengthMm: 100,
    resolution: '50m',
    layerStyles: DEFAULT_LAYER_STYLES,
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
})
