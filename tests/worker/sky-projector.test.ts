import { describe, expect, it } from 'vitest'

import { parseProject, serializeProject } from '@/core/export/project-file'
import type { SkyData } from '@/core/geo/sky'
import { DEFAULT_LAYER_STYLES, type LayerId, type LayerStyle } from '@/core/layers'
import { icosahedron } from '@/core/polyhedron/presets'
import { IDENTITY } from '@/core/quat'
import { DEFAULT_SETTINGS, type ProjectSettings } from '@/core/settings'
import skyJson from '@/data/sky.json'
import { type SkyRequest, Projector, mapKey } from '@/worker/projector'

const noEarth = () => Promise.reject(new Error('Earth data not needed'))
const loadSky = () => Promise.resolve(skyJson as unknown as SkyData)

const sky: SkyRequest = {
  flip: false,
  gridIntervalDeg: 15,
  magLimit: 5,
  minDiameterMm: 0.6,
  maxDiameterMm: 3,
  holeMagLimit: 2.5,
  holeMinDiameterMm: 1,
}

const styles = (patch: Partial<Record<LayerId, Partial<LayerStyle>>>) =>
  Object.fromEntries(
    Object.entries(DEFAULT_LAYER_STYLES).map(([id, st]) => [
      id,
      { ...st, ...patch[id as LayerId] },
    ]),
  ) as Record<LayerId, LayerStyle>

const request = {
  polyhedron: { id: 'icosahedron', def: icosahedron() },
  resolution: '50m' as const,
  edgeLengthMm: 100,
  rotation: IDENTITY,
  layerStyles: DEFAULT_LAYER_STYLES,
  graticuleIntervalDeg: 15,
  thicknessMm: 3,
  sky,
}

describe('Projector: the sky', () => {
  it('draws stars and constellation lines, and nothing of the Earth', async () => {
    const p = new Projector(noEarth, loadSky)
    const r = await p.project(request)
    const all = r.svgs!.join('')
    expect(all).toContain('inkscape:label="Stars"')
    expect(all).toContain('inkscape:label="Constellation lines"')
    expect(all).not.toContain('Coastlines')
    expect(all).not.toContain('Star holes')
    expect(r.starCounts).toEqual({ shown: 1627, holes: 0 })
  })

  it('cuts bright stars on their own layer, before the outline', async () => {
    const p = new Projector(noEarth, loadSky)
    const r = await p.project({
      ...request,
      layerStyles: styles({ starHoles: { enabled: true } }),
    })
    expect(r.starCounts).toEqual({ shown: 1627, holes: 93 })
    const withHoles = r.svgs!.filter((svg) => svg.includes('layer-starHoles'))
    expect(withHoles.length).toBeGreaterThan(0)
    for (const svg of withHoles) {
      expect(svg.indexOf('layer-starHoles')).toBeLessThan(svg.indexOf('layer-cut'))
      expect(svg).toContain('stroke="#FF8000"')
    }
  })

  it('draws the Milky Way, grid and ecliptic when switched on', async () => {
    const p = new Projector(noEarth, loadSky)
    const r = await p.project({
      ...request,
      layerStyles: styles({
        milkyWay: { enabled: true, mode: 'both' },
        skyGrid: { enabled: true },
        ecliptic: { enabled: true },
      }),
    })
    const all = r.svgs!.join('')
    for (const label of ['Milky Way', 'Celestial grid', 'Ecliptic &amp; equator']) {
      expect(all).toContain(`inkscape:label="${label}"`)
    }
  })

  it('mirrors the sky to the view from Earth', async () => {
    const p = new Projector(noEarth, loadSky)
    const a = await p.project(request)
    const b = await p.project({ ...request, sky: { ...sky, flip: true } })
    expect(b.svgs).not.toEqual(a.svgs)
    expect(b.starCounts).toEqual(a.starCounts)
  })

  it('serves live preview lines for the sky, with star markers', async () => {
    const p = new Projector(noEarth, loadSky)
    const segs = await p.lineSegments('sky', 15, {
      magLimit: 5,
      maxRadiusRad: 0.01,
      minRadiusRad: 0.002,
    })
    for (const id of ['constellations', 'ecliptic', 'skyGrid', 'milkyWayEdge', 'starRings']) {
      expect(segs.lines[id as keyof typeof segs.lines]?.length).toBeGreaterThan(0)
    }
    expect(segs.lines.coastlines).toBeUndefined()
  })

  it('picks the dataset from the subject and handedness', () => {
    expect(mapKey('50m', null)).toBe('50m')
    expect(mapKey('50m', sky)).toBe('sky')
    expect(mapKey('110m', { ...sky, flip: true })).toBe('sky-mirrored')
  })
})

describe('project files: the sky', () => {
  it('round-trip every sky setting', () => {
    const s: ProjectSettings = {
      ...DEFAULT_SETTINGS,
      subject: 'sky',
      skyFlip: true,
      starMagLimit: 4.2,
      starMinDiameterMm: 0.8,
      starMaxDiameterMm: 2.5,
      starHoleMagLimit: 1.5,
      starHoleMinDiameterMm: 1.2,
      skyGridIntervalDeg: 30,
    }
    const { settings, notes } = parseProject(serializeProject(s))
    expect(notes).toEqual([])
    expect({ ...settings, rotation: null }).toEqual({ ...s, rotation: null })
  })

  it('open older files as the Earth, with sky defaults and layers', () => {
    const file = JSON.parse(serializeProject(DEFAULT_SETTINGS)) as Record<string, unknown> & {
      layerStyles: Record<string, unknown>
    }
    for (const k of ['subject', 'skyFlip', 'starMagLimit', 'starHoleMagLimit']) delete file[k]
    delete file.layerStyles.stars
    const { settings, notes } = parseProject(JSON.stringify(file))
    expect(notes).toEqual([])
    expect(settings.subject).toBe('earth')
    expect(settings.starMagLimit).toBe(DEFAULT_SETTINGS.starMagLimit)
    expect(settings.layerStyles.stars).toEqual(DEFAULT_LAYER_STYLES.stars)
  })

  it('replace out-of-range sky values with defaults and say so', () => {
    const file = {
      ...(JSON.parse(serializeProject(DEFAULT_SETTINGS)) as object),
      subject: 'mars',
      starMagLimit: 9,
    }
    const { settings, notes } = parseProject(JSON.stringify(file))
    expect(settings.subject).toBe('earth')
    expect(settings.starMagLimit).toBe(5)
    expect(notes.join(' ')).toMatch(/subject/)
    expect(notes.join(' ')).toMatch(/starMagLimit/)
  })
})
