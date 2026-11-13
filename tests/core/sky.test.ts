import { geoArea, geoContains } from 'd3-geo'
import type { MultiPolygon, Position } from 'geojson'
import { describe, expect, it } from 'vitest'

import { lonLatToVec3, vec3ToLonLat } from '@/core/geo/lonlat'
import {
  OBLIQUITY_DEG,
  type SkyData,
  eclipticAndEquator,
  mirrorSky,
  prepareStars,
  starMarkers,
} from '@/core/geo/sky'
import { DEFAULT_LAYER_STYLES, layerInSubject, subjectStyles } from '@/core/layers'
import { ringArea, toPaths64 } from '@/core/planar/clipper'
import { type StarOptions, circleRing, sortHoles, starDiameterMm, starSizeMm } from '@/core/stars'
import { angle, length } from '@/core/vec3'
import skyJson from '@/data/sky.json'

const sky = skyJson as unknown as SkyData
const GALACTIC_CENTRE: [number, number] = [-93.6, -29.0]
const NORTH_GALACTIC_POLE: [number, number] = [-167.14, 27.13]
const milkyWay = (s: SkyData): MultiPolygon => ({
  type: 'MultiPolygon',
  coordinates: s.milkyWay as Position[][][],
})

describe('bundled sky data', () => {
  it('has every star to magnitude 6, brightest first, with valid positions', () => {
    const n = sky.stars.length / 3
    expect(n).toBe(5044)
    let last = -Infinity
    for (let i = 0; i < sky.stars.length; i += 3) {
      const [lon, lat, mag] = [sky.stars[i]!, sky.stars[i + 1]!, sky.stars[i + 2]!]
      expect(Math.abs(lon)).toBeLessThanOrEqual(180)
      expect(Math.abs(lat)).toBeLessThanOrEqual(90)
      expect(mag).toBeGreaterThanOrEqual(last)
      expect(mag).toBeLessThanOrEqual(6)
      last = mag
    }
    expect(sky.stars[2]).toBeCloseTo(-1.44, 2) // Sirius
  })

  it('has constellation lines and one Milky Way band around the sky', () => {
    expect(sky.constellations.length).toBeGreaterThan(80)
    for (const line of sky.constellations) expect(line.length).toBeGreaterThanOrEqual(2)
    expect(geoContains(milkyWay(sky), GALACTIC_CENTRE)).toBe(true)
    expect(geoContains(milkyWay(sky), [86.4, 28.9])).toBe(true)
    expect(geoContains(milkyWay(sky), NORTH_GALACTIC_POLE)).toBe(false)
  })

  it('winds every Milky Way ring the d3 way, so its area is the band (about 2.1 sr)', () => {
    // Containment is even-odd and ignores direction; area and our fills follow the winding.
    expect(geoArea(milkyWay(sky))).toBeGreaterThan(2)
    expect(geoArea(milkyWay(sky))).toBeLessThan(2.25)
  })
})

describe('mirrorSky', () => {
  const mirrored = mirrorSky(sky)

  it('is its own inverse', () => {
    expect(mirrorSky(mirrored)).toEqual(sky)
  })

  it('negates right ascension and keeps declination and brightness', () => {
    expect(mirrored.stars.slice(0, 3)).toEqual([-sky.stars[0]!, sky.stars[1], sky.stars[2]])
    expect(mirrored.constellations[0]![0]).toEqual([
      -sky.constellations[0]![0]![0]!,
      sky.constellations[0]![0]![1],
    ])
  })

  it('keeps the Milky Way winding, so it still covers the mirrored band', () => {
    expect(geoContains(milkyWay(mirrored), [93.6, -29.0])).toBe(true)
    expect(geoContains(milkyWay(mirrored), [167.14, 27.13])).toBe(false)
    expect(geoArea(milkyWay(mirrored))).toBeCloseTo(geoArea(milkyWay(sky)), 9)
  })
})

describe('ecliptic and equator', () => {
  const lines = eclipticAndEquator()
  const half = lines.length / 2
  const equator = lines.slice(0, half).flat()
  const ecliptic = lines.slice(half).flat()

  it('draws the equator on declination 0', () => {
    for (const p of equator) expect(p[1]).toBeCloseTo(0, 12)
  })

  it('tilts the ecliptic by the obliquity, crossing the equator at RA 0 h and 12 h', () => {
    const decs = ecliptic.map((p) => p[1]!)
    expect(Math.max(...decs)).toBeCloseTo(OBLIQUITY_DEG, 6)
    expect(Math.min(...decs)).toBeCloseTo(-OBLIQUITY_DEG, 6)
    const crossings = ecliptic.filter((p) => Math.abs(p[1]!) < 1e-9).map((p) => Math.abs(p[0]!))
    expect(crossings.some((ra) => ra < 1e-9)).toBe(true)
    expect(crossings.some((ra) => Math.abs(ra - 180) < 1e-9)).toBe(true)
    // At RA 6 h the ecliptic is at its northernmost.
    const top = ecliptic.reduce((a, b) => (b[1]! > a[1]! ? b : a))
    expect(top[0]).toBeCloseTo(90, 6)
  })

  it('splits each circle into arcs short enough to cull', () => {
    for (const arc of lines) {
      const pts = arc.map((p) => lonLatToVec3(p[0]!, p[1]!))
      expect(angle(pts[0]!, pts[pts.length - 1]!)).toBeLessThan(Math.PI / 2)
    }
  })
})

describe('stars', () => {
  const o: StarOptions = { magLimit: 5, minDiameterMm: 0.6, maxDiameterMm: 3, holes: null }

  it('size linearly by magnitude between magnitude 0 and the limit, clamped', () => {
    expect(starDiameterMm(0, o)).toBe(3)
    expect(starDiameterMm(-1.44, o)).toBe(3)
    expect(starDiameterMm(5, o)).toBeCloseTo(0.6, 12)
    expect(starDiameterMm(2.5, o)).toBeCloseTo(1.8, 12)
    expect(starDiameterMm(6, o)).toBeCloseTo(0.6, 12)
  })

  it('never cut holes below the minimum, and only for bright enough stars', () => {
    const h: StarOptions = { ...o, holes: { magLimit: 4.5, minDiameterMm: 1.2 } }
    expect(starSizeMm(4.5, h)).toBe(1.2) // engraved size would be 0.84
    expect(starSizeMm(0, h)).toBe(3)
    expect(starSizeMm(4.8, h)).toBeCloseTo(starDiameterMm(4.8, o), 12) // engraved, not a hole
  })

  it('prepare as unit vectors, filtered by magnitude', () => {
    const all = prepareStars(sky.stars)
    expect(all).toHaveLength(5044)
    expect(prepareStars(sky.stars, 5)).toHaveLength(1627)
    expect(prepareStars(sky.stars, 2.5)).toHaveLength(93)
    for (const s of all.slice(0, 50)) expect(length(s.dir)).toBeCloseTo(1, 12)
    const [lon, lat] = vec3ToLonLat(all[0]!.dir)
    expect([lon, lat]).toEqual([
      expect.closeTo(sky.stars[0]!, 6) as unknown,
      expect.closeTo(sky.stars[1]!, 6) as unknown,
    ])
  })

  it('draw live markers as small circles of the requested angular size', () => {
    const stars = prepareStars(sky.stars, 1)
    const markers = starMarkers(stars, 1, () => 0.01)
    expect(markers).toHaveLength(stars.length)
    markers.forEach((ring, i) => {
      for (const p of ring) expect(angle(p, stars[i]!.dir)).toBeCloseTo(0.01, 9)
    })
  })
})

describe('circleRing', () => {
  it('is a counter-clockwise circle of the given diameter', () => {
    const ring = circleRing([5, -2], 3)
    expect(ringArea(ring)).toBeGreaterThan(0)
    for (const [x, y] of ring) expect(Math.hypot(x - 5, y + 2)).toBeCloseTo(1.5, 12)
    expect(ringArea(ring)).toBeCloseTo(Math.PI * 1.5 ** 2, 1)
  })
})

describe('sortHoles', () => {
  const square = toPaths64([
    [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
  ])
  const area = (paths: ReturnType<typeof toPaths64>) =>
    paths.reduce((s, p) => s + ringArea(p.map(({ x, y }) => [x / 1000, y / 1000])), 0)

  it('keeps inside holes, notches the outline with crossing ones and drops outside ones', () => {
    const inside = circleRing([10, 10], 2)
    const crossing = circleRing([0, 10], 2) // centred on the left edge: half inside
    const outside = circleRing([-5, 10], 2)
    const r = sortHoles([inside, crossing, outside], square)
    expect(r.inside).toHaveLength(1)
    expect(r.all).toHaveLength(2)
    expect(area(r.panel)).toBeCloseTo(400 - ringArea(crossing) / 2, 2)
  })

  it('merges overlapping holes', () => {
    const r = sortHoles([circleRing([10, 10], 2), circleRing([10.5, 10], 2)], square)
    expect(r.inside).toHaveLength(1)
    expect(ringArea(r.inside[0]!)).toBeGreaterThan(ringArea(circleRing([0, 0], 2)))
  })

  it('leaves the panel untouched with no holes', () => {
    expect(sortHoles([], square).panel).toBe(square)
  })
})

describe('subject layers', () => {
  it('keep each subject to its own layers, with the cut and guide in both', () => {
    expect(layerInSubject('cut', 'sky')).toBe(true)
    expect(layerInSubject('guide', 'earth')).toBe(true)
    expect(layerInSubject('coastlines', 'sky')).toBe(false)
    expect(layerInSubject('stars', 'earth')).toBe(false)
    const sky = subjectStyles(DEFAULT_LAYER_STYLES, 'sky')
    expect(sky.coastlines.enabled).toBe(false)
    expect(sky.stars.enabled).toBe(true)
    expect(sky.cut.enabled).toBe(true)
    const earth = subjectStyles(DEFAULT_LAYER_STYLES, 'earth')
    expect(earth.stars.enabled).toBe(false)
    expect(earth.coastlines.enabled).toBe(true)
  })
})
