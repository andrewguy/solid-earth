import { geoArea } from 'd3-geo'
import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'

import { lonLatToVec3, vec3ToLonLat } from '@/core/geo/lonlat'
import {
  MOON_RADIUS_KM,
  type MoonData,
  craterCount,
  craterRims,
  craterShadowSets,
  craterShadows,
  craterVariation,
  shadowFraction,
} from '@/core/geo/moon'
import moonJson from '@/data/moon.json'
import { type Vec3, add, cross, dot, normalize, scale } from '@/core/vec3'

const ringArea = (ring: readonly Vec3[]) => {
  const pts: Position[] = ring.map((p) => vec3ToLonLat(p))
  return geoArea({ type: 'Polygon', coordinates: [[...pts, pts[0]!]] })
}

describe('shadowFraction', () => {
  it('shades 40 % of small craters, falling to 10 % for big basins', () => {
    expect(shadowFraction(10)).toBe(0.4)
    expect(shadowFraction(50)).toBeCloseTo(0.4, 12)
    expect(shadowFraction(158)).toBeCloseTo(0.25, 2)
    expect(shadowFraction(500)).toBeCloseTo(0.1, 12)
    expect(shadowFraction(1000)).toBe(0.1)
  })
})

describe('craterShadows', () => {
  const craters = [
    [-20.08, 9.62, 96], // Copernicus
    [170, -40, 60],
    [-179.9, 10, 40], // across the antimeridian
    [45, 89.5, 30], // at the north pole
    [0, -89.9, 20], // at the south pole
    [10, 0, 12],
  ]

  const frame = (c: Vec3) => {
    const east = normalize(cross([0, 0, 1], c))
    return { east, north: cross(c, east) }
  }
  /** Gnomonic-plane coordinates of p about c, in (east, north). */
  const plane = (p: Vec3, c: Vec3): [number, number] => {
    const { east, north } = frame(c)
    return [dot(p, east) / dot(p, c), dot(p, north) / dot(p, c)]
  }
  /** Whether p is inside the (closed) rim ring around c, or on it. */
  const insideRim = (p: Vec3, rim: readonly Vec3[], c: Vec3) => {
    const [px, py] = plane(p, c)
    const dist = Math.hypot(px, py)
    if (dist < 1e-12) return true
    const [dx, dy] = [px / dist, py / dist]
    // The rim is star-shaped about its centre: find where the ray towards p leaves it.
    for (let k = 0; k + 1 < rim.length; k++) {
      const [ax, ay] = plane(rim[k]!, c)
      const [bx, by] = plane(rim[k + 1]!, c)
      const den = dx * (by - ay) - dy * (bx - ax)
      if (Math.abs(den) < 1e-18) continue
      const t = (ax * (by - ay) - ay * (bx - ax)) / den // distance along the ray
      const w = (ax * dy - ay * dx) / den // position along the edge
      if (t > 0 && w >= -1e-9 && w <= 1 + 1e-9) return dist <= t * (1 + 1e-6)
    }
    return false
  }
  const centroid = (ring: readonly Vec3[]) =>
    normalize(ring.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]))
  /** Compass bearing (degrees, clockwise from north) from a to b. */
  const bearing = (a: Vec3, b: Vec3) => {
    const { east, north } = frame(a)
    const off = add(b, scale(a, -dot(b, a)))
    return ((Math.atan2(dot(off, east), dot(off, north)) * 180) / Math.PI + 360) % 360
  }

  it('gives each crater one d3-wound crescent, inside its rim, of the right area', () => {
    const sets = craterShadowSets(craters.flat(), 10)
    const rims = craterRims(craters.flat(), 10)
    expect(sets).toHaveLength(craters.length)
    expect(craterShadows(craters.flat(), 10)).toHaveLength(sets.flat().length)
    sets.forEach(([polygon], i) => {
      const [lon, lat, d] = craters[i]!
      const c = lonLatToVec3(lon!, lat!)
      expect(polygon).toHaveLength(1)
      const ring = polygon![0]!
      for (const p of ring) expect(insideRim(p, rims[i]!, c)).toBe(true)
      // Planar crescent of a round crater: the disc minus the lens it shares with the moved
      // disc. Each crater's own depth (× 0.7–1.3), shape and ragged edge move the area within
      // these bounds.
      const r = d! / 2 / MOON_RADIUS_KM
      const crescent = (f: number) => {
        const s = Math.min(0.6, f) * r
        const lens = 2 * r * r * Math.acos(s / (2 * r)) - (s / 2) * Math.sqrt(4 * r * r - s * s)
        return Math.PI * r * r - lens
      }
      const f = shadowFraction(d!)
      const area = ringArea(ring)
      // Small, so wound the d3 way (the other way it would be nearly the whole sphere).
      expect(area).toBeLessThan(0.01)
      expect(area).toBeGreaterThan(crescent(f * 0.7) * 0.7)
      expect(area).toBeLessThan(crescent(f * 1.3) * 1.35)
    })
  })

  it('puts the crescent on the north-west side of each crater, towards the light', () => {
    craterShadowSets(craters.slice(0, 3).flat(), 10).forEach((set, i) => {
      const ring = set[0]![0]!
      const [lon, lat] = craters[i]!
      // North-west, give or take each crater's own ± 12°, shape and ragged edge.
      const az = bearing(lonLatToVec3(lon!, lat!), centroid(ring))
      expect(Math.abs(az - 315)).toBeLessThan(25)
    })
  })

  it('leaves out craters smaller than the limit', () => {
    expect(craterShadowSets(craters.flat(), 50)).toHaveLength(2)
  })

  describe('central peaks', () => {
    const moon = moonJson as unknown as MoonData
    const big = moon.craters.slice(0, 3 * craterCount(moon.craters, 30))
    const sets = craterShadowSets(big, 30)
    const variations = Array.from({ length: sets.length }, (_, i) =>
      craterVariation(big[3 * i]!, big[3 * i + 1]!, big[3 * i + 2]!),
    )

    it('appear on about half the craters of 45–180 km, and on no others', () => {
      let inRange = 0
      let withPeaks = 0
      sets.forEach((set, i) => {
        const d = big[3 * i + 2]!
        expect(set).toHaveLength(1 + variations[i]!.peaks.length)
        if (d >= 45 && d <= 180) {
          inRange++
          if (set.length > 1) withPeaks++
        } else expect(set).toHaveLength(1)
      })
      expect(inRange).toBeGreaterThan(500)
      expect(withPeaks / inRange).toBeGreaterThan(0.45)
      expect(withPeaks / inRange).toBeLessThan(0.65)
      // Some are pairs.
      expect(sets.some((set) => set.length === 3)).toBe(true)
    })

    it('cast their shadows away from the light, inside the rim', () => {
      const rims = craterRims(big, 30)
      let checked = 0
      sets.forEach((set, i) => {
        if (set.length === 1) return
        const [lon, lat, d] = [big[3 * i]!, big[3 * i + 1]!, big[3 * i + 2]!]
        const c = lonLatToVec3(lon, lat)
        const { east, north } = frame(c)
        const west = scale(east, -1)
        const r = Math.tan(d / 2 / MOON_RADIUS_KM)
        set.slice(1).forEach(([ring], k) => {
          const peak = variations[i]!.peaks[k]!
          const top = normalize(add(c, add(scale(north, peak.x * r), scale(west, peak.y * r))))
          for (const p of ring!) expect(insideRim(p, rims[i]!, c)).toBe(true)
          // South-east of the peak, give or take the crater's own ± 12°.
          expect(Math.abs(bearing(top, centroid(ring!)) - 135)).toBeLessThan(15)
          expect(ringArea(ring!)).toBeLessThan(0.01)
          checked++
        })
      })
      expect(checked).toBeGreaterThan(300)
    })
  })

  it('is a simple ring: no edge crosses another', () => {
    const many: number[] = []
    for (let k = 0; k < 300; k++)
      many.push(-170 + k * 1.13, -60 + ((k * 7) % 120), 10 + (k % 40) * 7)
    for (const [ring] of craterShadows(many, 10)) {
      const c = normalize(ring!.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]))
      const east = normalize(cross([0, 0, 1], c))
      const north = cross(c, east)
      const pts = ring!.map((p) => [dot(p, east) / dot(p, c), dot(p, north) / dot(p, c)] as const)
      const cross2 = (a: readonly number[], b: readonly number[], q: readonly number[]) =>
        (b[0]! - a[0]!) * (q[1]! - a[1]!) - (b[1]! - a[1]!) * (q[0]! - a[0]!)
      const n = pts.length
      for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue
          const [a, b, p, q] = [pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!]
          const crosses =
            cross2(a, b, p) * cross2(a, b, q) < 0 && cross2(p, q, a) * cross2(p, q, b) < 0
          expect(crosses).toBe(false)
        }
      }
    }
  })
})

describe('craterVariation', () => {
  it('is the same every time for the same crater', () => {
    const a = craterVariation(-20.08, 9.62, 96)
    const b = craterVariation(-20.08, 9.62, 96)
    expect(a.depth).toBe(b.depth)
    expect(a.azimuthDeg).toBe(b.azimuthDeg)
    for (const t of [0.1, 0.5, 0.9]) expect(a.edge(t)).toBe(b.edge(t))
  })

  it('differs from crater to crater, within its bounds', () => {
    const vs = Array.from({ length: 500 }, (_, k) =>
      craterVariation(-179 + k * 0.71, -80 + ((k * 13) % 160), 10 + (k % 90)),
    )
    const depths = vs.map((v) => v.depth)
    const azimuths = vs.map((v) => v.azimuthDeg)
    for (const v of vs) {
      expect(v.depth).toBeGreaterThanOrEqual(0.7)
      expect(v.depth).toBeLessThanOrEqual(1.3)
      expect(Math.abs(v.azimuthDeg)).toBeLessThanOrEqual(12)
      for (let t = 0; t <= 1; t += 0.05) expect(Math.abs(v.edge(t))).toBeLessThanOrEqual(0.35)
    }
    // Spread across the range, not bunched.
    expect(Math.min(...depths)).toBeLessThan(0.75)
    expect(Math.max(...depths)).toBeGreaterThan(1.25)
    expect(Math.min(...azimuths)).toBeLessThan(-10)
    expect(Math.max(...azimuths)).toBeGreaterThan(10)
    expect(new Set(depths).size).toBe(vs.length)
  })
})
