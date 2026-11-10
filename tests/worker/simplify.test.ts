import { describe, expect, it } from 'vitest'
import type { Topology } from 'topojson-specification'
import { presimplify, sphericalTriangleArea } from 'topojson-simplify'

import land50m from '@/data/land-50m.topo.json'
import { type SimplifiableTopology, simplified } from '@/worker/bundled-data'

const countPoints = (t: Topology) => t.arcs.reduce((n, arc) => n + arc.length, 0)

describe('10m simplification (tested on 50m data)', () => {
  const pre = presimplify(land50m as unknown as SimplifiableTopology, sphericalTriangleArea)
  const full = countPoints(pre)

  it.each([0.1, 0.25, 0.5])('keeps roughly %f of the points', (detail) => {
    const [t] = simplified([pre], detail)
    const kept = countPoints(t!) / full
    expect(kept).toBeGreaterThan(detail * 0.7)
    expect(kept).toBeLessThan(detail * 1.3 + 0.02)
  })

  it('detail 1 keeps everything', () => {
    expect(countPoints(simplified([pre], 1)[0]!)).toBe(full)
  })
})
