import { geoArea } from 'd3-geo'
import { describe, expect, it } from 'vitest'

import { type LandTopology, landFeatures } from '@/core/geo/topojson'
import land110m from '@/data/land-110m.topo.json'
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
