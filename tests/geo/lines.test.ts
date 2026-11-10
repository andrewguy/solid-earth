import fc from 'fast-check'
import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'

import { densifyLonLat, isSeamSegment, removeSeams } from '@/core/geo/lines'
import {
  type CountriesTopology,
  type LandTopology,
  borderLines,
  coastlineLines,
} from '@/core/geo/topojson'
import countries110m from '@/data/countries-110m.topo.json'
import countries50m from '@/data/countries-50m.topo.json'
import land110m from '@/data/land-110m.topo.json'
import land50m from '@/data/land-50m.topo.json'

describe('removeSeams', () => {
  it('splits lines at antimeridian and south-pole seams only', () => {
    const line: Position[] = [
      [170, 60],
      [180, 65],
      [180, 70], // seam: along +180
      [175, 72],
      [-180, 72], // crossing to −180 is not a seam (different sides)
    ]
    expect(removeSeams([line])).toEqual([
      [
        [170, 60],
        [180, 65],
      ],
      [
        [180, 70],
        [175, 72],
        [-180, 72],
      ],
    ])
    expect(isSeamSegment([10, -89.999], [20, -89.999])).toBe(true)
    expect(isSeamSegment([-180, -84.7], [-179.9, -84.7])).toBe(false)
  })

  it.each([
    ['110m', land110m, countries110m],
    ['50m', land50m, countries50m],
  ])('leaves no seams in %s coastlines or borders', (_res, land, countries) => {
    const lines = [
      ...removeSeams(coastlineLines(land as unknown as LandTopology)),
      ...removeSeams(borderLines(countries as unknown as CountriesTopology)),
    ]
    expect(lines.length).toBeGreaterThan(100)
    for (const l of lines) {
      for (let i = 1; i < l.length; i++) expect(isSeamSegment(l[i - 1]!, l[i]!)).toBe(false)
    }
  })
})

describe('densifyLonLat', () => {
  const lonLat = fc.tuple(
    fc.double({ min: -180, max: 180, noNaN: true }),
    fc.double({ min: -90, max: 90, noNaN: true }),
  )

  it('keeps original points and bounds every step to 0.5°', () => {
    fc.assert(
      fc.property(fc.array(lonLat, { minLength: 2, maxLength: 10 }), (line) => {
        const out = densifyLonLat(line, 0.5)
        // Originals appear in order, as the same objects.
        let k = 0
        for (const p of out) if (p === line[k]) k++
        if (k !== line.length) return false
        return out.slice(1).every((b, i) => {
          const a = out[i]!
          let dLon = Math.abs(b[0]! - a[0]!)
          if (dLon > 180) dLon = 360 - dLon
          return dLon <= 0.5 + 1e-9 && Math.abs(b[1]! - a[1]!) <= 0.5 + 1e-9
        })
      }),
    )
  })

  it('goes the short way across the antimeridian', () => {
    const out = densifyLonLat([
      [179, 0],
      [-179, 0],
    ])
    expect(out).toHaveLength(5)
    for (const p of out.slice(1, -1)) expect(Math.abs(p[0]!)).toBeGreaterThanOrEqual(179)
  })
})
