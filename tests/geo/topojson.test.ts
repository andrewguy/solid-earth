import { geoArea } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { describe, expect, it } from 'vitest'

import { type LandTopology, landFeatures } from '@/core/geo/topojson'
import land110m from '@/data/land-110m.topo.json'
import lakes110m from '@/data/lakes-110m.topo.json'
import lakes50m from '@/data/lakes-50m.topo.json'
import land50m from '@/data/land-50m.topo.json'

const SPHERE = 4 * Math.PI

describe.each([
  ['110m', land110m],
  ['50m', land50m],
])('bundled land %s', (_res, topo) => {
  const land = landFeatures(topo as unknown as LandTopology)

  it('decodes to polygon features', () => {
    expect(land.features.length).toBeGreaterThan(0)
    for (const f of land.features) expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type)
  })

  it('covers ~29% of the sphere (so ring winding is read correctly)', () => {
    const fraction = geoArea(land) / SPHERE
    expect(fraction).toBeGreaterThan(0.27)
    expect(fraction).toBeLessThan(0.31)
  })
})

describe.each([
  ['110m', lakes110m],
  ['50m', lakes50m],
])('bundled lakes %s', (_res, topo) => {
  const t = topo as unknown as Topology<{ lakes: GeometryCollection }>
  const lakes = feature(t, t.objects.lakes)

  it('has small, correctly wound polygons (d3 convention)', () => {
    expect(lakes.features.length).toBeGreaterThan(10)
    // Mis-wound rings would each cover most of the sphere.
    for (const f of lakes.features) expect(geoArea(f)).toBeLessThan(0.01)
  })
})
