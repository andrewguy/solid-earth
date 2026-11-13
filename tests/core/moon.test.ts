import { geoArea, geoContains } from 'd3-geo'
import type { MultiPolygon, Position } from 'geojson'
import { describe, expect, it } from 'vitest'

import type { MoonData } from '@/core/geo/moon'
import moonJson from '@/data/moon.json'

const moon = moonJson as unknown as MoonData
const maria: MultiPolygon = { type: 'MultiPolygon', coordinates: moon.maria as Position[][][] }

describe('bundled Moon data', () => {
  it('has the maria as one region covering about 16 % of the surface', () => {
    const share = geoArea(maria) / (4 * Math.PI)
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.18)
  })

  it('has closed rings within lon/lat bounds, each exterior well within a hemisphere', () => {
    for (const polygon of moon.maria) {
      // Spherical clipping needs rings well within a hemisphere (plan §15.6).
      const exterior = geoArea({ type: 'Polygon', coordinates: [polygon[0]! as Position[]] })
      expect(exterior).toBeLessThan(Math.PI)
      for (const ring of polygon) {
        expect(ring.length).toBeGreaterThanOrEqual(4)
        expect(ring[0]).toEqual(ring.at(-1))
        for (const [lon, lat] of ring) {
          expect(Math.abs(lon!)).toBeLessThanOrEqual(180)
          expect(Math.abs(lat!)).toBeLessThanOrEqual(90)
        }
      }
    }
  })

  it.each([
    ['Mare Tranquillitatis', [31.4, 8.5], true],
    ['Mare Crisium', [59.1, 17.0], true],
    ['Mare Imbrium', [-15.6, 32.8], true],
    ['Mare Moscoviense (far side)', [147.9, 27.3], true],
    ['Tycho', [-11.2, -43.3], false],
    ['far-side highlands', [180, 0], false],
    ['south pole', [0, -90], false],
  ] as const)('puts %s %s the maria', (_, p, inside) => {
    expect(geoContains(maria, [...p])).toBe(inside)
  })

  it('has craters of 10 km or more, largest first, within bounds', () => {
    const n = moon.craters.length / 3
    expect(n).toBeGreaterThan(5000)
    let last = Infinity
    for (let i = 0; i < moon.craters.length; i += 3) {
      const [lon, lat, d] = [moon.craters[i]!, moon.craters[i + 1]!, moon.craters[i + 2]!]
      expect(Math.abs(lon)).toBeLessThanOrEqual(180)
      expect(Math.abs(lat)).toBeLessThanOrEqual(90)
      expect(d).toBeGreaterThanOrEqual(10)
      expect(d).toBeLessThanOrEqual(last)
      last = d
    }
  })

  it('has Copernicus about 93–96 km across at 9.6° N, 20.1° W', () => {
    const found = []
    for (let i = 0; i < moon.craters.length; i += 3) {
      const [lon, lat, d] = [moon.craters[i]!, moon.craters[i + 1]!, moon.craters[i + 2]!]
      if (Math.abs(lon + 20.08) < 0.1 && Math.abs(lat - 9.62) < 0.1) found.push(d)
    }
    expect(found).toHaveLength(1)
    expect(found[0]).toBeGreaterThan(90)
    expect(found[0]).toBeLessThan(100)
  })
})
