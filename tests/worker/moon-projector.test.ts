import { describe, expect, it } from 'vitest'

import type { MoonData } from '@/core/geo/moon'
import { DEFAULT_LAYER_STYLES, type LayerId, type LayerStyle } from '@/core/layers'
import { icosahedron } from '@/core/polyhedron/presets'
import { IDENTITY } from '@/core/quat'
import moonJson from '@/data/moon.json'
import { type MoonRequest, Projector, mapKey, requestSubject } from '@/worker/projector'

const noEarth = () => Promise.reject(new Error('Earth data not needed'))
const noSky = () => Promise.reject(new Error('sky data not needed'))
const loadMoon = () => Promise.resolve(moonJson as unknown as MoonData)

const moon: MoonRequest = { gridIntervalDeg: 15, craterMinDiameterKm: 30 }

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
  moon,
}

describe('Projector: the Moon', () => {
  it('draws maria outlines and craters, and nothing of the Earth or sky', async () => {
    const p = new Projector(noEarth, noSky, loadMoon)
    const r = await p.project(request)
    const all = r.svgs!.join('')
    expect(all).toContain('inkscape:label="Maria"')
    expect(all).toContain('inkscape:label="Craters"')
    expect(all).not.toContain('Coastlines')
    expect(all).not.toContain('Stars')
    expect(all).not.toContain('Lunar grid')
    expect(r.craterCount).toBe(2301)
    expect(r.starCounts).toBeNull()
    // Outline mode: maria stroked, not filled.
    expect(r.faces.some((f) => f.lines.mariaEdge)).toBe(true)
    expect(r.faces.every((f) => !f.fills.maria)).toBe(true)
  })

  it('fills crater shadows by default, on their own layer, and only when switched on', async () => {
    const p = new Projector(noEarth, noSky, loadMoon)
    const on = await p.project(request)
    expect(on.faces.some((f) => f.fills.craterShadows)).toBe(true)
    expect(on.svgs!.join('')).toContain('inkscape:label="Crater shadows"')
    expect(on.svgs!.join('')).toContain('#FF00FF')
    const off = await p.project({
      ...request,
      layerStyles: styles({ craterShadows: { enabled: false } }),
    })
    expect(off.faces.every((f) => !f.fills.craterShadows)).toBe(true)
    expect(off.svgs!.join('')).not.toContain('Crater shadows')
  })

  it('draws fewer craters for a higher limit', async () => {
    const p = new Projector(noEarth, noSky, loadMoon)
    const count = async (km: number) => {
      const r = await p.project({ ...request, moon: { ...moon, craterMinDiameterKm: km } })
      const rims = r.faces.reduce((n, f) => n + (f.lines.craters?.starts.length ?? 1) - 1, 0)
      return { count: r.craterCount, rims }
    }
    const at30 = await count(30)
    const at100 = await count(100)
    expect(at100.count).toBeLessThan(at30.count!)
    expect(at100.rims).toBeLessThan(at30.rims)
    expect((await count(10)).count).toBe(5626)
  })

  it('fills the maria and draws the lunar grid when switched on', async () => {
    const p = new Projector(noEarth, noSky, loadMoon)
    const r = await p.project({
      ...request,
      layerStyles: styles({ maria: { mode: 'both' }, moonGrid: { enabled: true } }),
    })
    expect(r.faces.some((f) => f.fills.maria)).toBe(true)
    expect(r.faces.some((f) => f.lines.mariaEdge)).toBe(true)
    expect(r.faces.some((f) => f.lines.moonGrid)).toBe(true)
    expect(r.svgs!.join('')).toContain('inkscape:label="Lunar grid"')
  })

  it('gives live line segments for the maria, craters and grid', async () => {
    const p = new Projector(noEarth, noSky, loadMoon)
    const segs = await p.lineSegments('moon', 15, undefined, 30)
    for (const id of ['mariaEdge', 'craters', 'craterShadowEdge', 'moonGrid'] as const) {
      expect(segs.lines[id]?.length).toBeGreaterThan(0)
    }
    expect(segs.lines.coastlines).toBeUndefined()
    const fewer = await p.lineSegments('moon', 15, undefined, 100)
    expect(fewer.lines.craters!.length).toBeLessThan(segs.lines.craters!.length)
  })

  it('picks the dataset and subject from the request; the sky wins over the Moon', () => {
    const sky = {
      flip: false,
      gridIntervalDeg: 15,
      magLimit: 5,
      minDiameterMm: 0.6,
      maxDiameterMm: 3,
      holeMagLimit: 2.5,
      holeMinDiameterMm: 1,
    }
    expect(mapKey('50m', null, moon)).toBe('moon')
    expect(mapKey('50m', sky, moon)).toBe('sky')
    expect(requestSubject({ moon })).toBe('moon')
    expect(requestSubject({ sky, moon })).toBe('sky')
    expect(requestSubject({})).toBe('earth')
  })
})
