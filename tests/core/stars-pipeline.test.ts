import { geoContains } from 'd3-geo'
import type { MultiPolygon, Position } from 'geojson'
import { describe, expect, it } from 'vitest'

import { preparePolygons } from '@/core/geo/lines'
import { vec3ToLonLat } from '@/core/geo/lonlat'

import { type PreparedStar, type SkyData, mirrorSky } from '@/core/geo/sky'
import { ringArea } from '@/core/planar/clipper'
import { type ArtworkOptions, buildAllFaces, longestEdge, prepareMap } from '@/core/pipeline'
import { buildFrames, planePoint } from '@/core/polyhedron/faces'
import { icosahedron, preset } from '@/core/polyhedron/presets'
import type { StarOptions } from '@/core/stars'
import { type Vec2, type Vec3, add, normalize, scale } from '@/core/vec3'
import skyJson from '@/data/sky.json'

const skyData = skyJson as unknown as SkyData

const frames = buildFrames(icosahedron())
const mmPerUnit = 100 / longestEdge(frames)
const area = (rings: readonly (readonly Vec2[])[] | undefined) =>
  (rings ?? []).reduce((s, r) => s + ringArea(r), 0)

/** Every star the same size: magnitude 0 → 3 mm. */
const STARS: StarOptions = { magLimit: 5, minDiameterMm: 3, maxDiameterMm: 3, holes: null }
const HOLES: StarOptions = { ...STARS, holes: { magLimit: 1, minDiameterMm: 1 } }
const CIRCLE = Math.PI * 1.5 ** 2

const edge = frames.edges[0]!
const v = frames.def.vertices
/** The midpoint of a shared edge, as a direction. */
const onEdge = normalize(add(v[edge.a]!, v[edge.b]!))
/** The centre of the first face of that edge. */
const centre = normalize(
  frames.faces[edge.faces[0]]!.vertices.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]),
)

const art = (stars: PreparedStar[], o: StarOptions, extra: Partial<ArtworkOptions> = {}) =>
  buildAllFaces(frames, prepareMap({}, {}, stars), {
    mmPerUnit,
    precisionMm: null,
    fills: { stars: true },
    stars: o,
    ...extra,
  })

describe('stars in the pipeline', () => {
  it('draws a star inside a face as one dot of its size, on that face only', () => {
    const arts = art([{ dir: centre, mag: 0 }], STARS)
    const withStar = arts.filter((a) => area(a.fills.stars) > 0)
    expect(withStar.map((a) => a.faceIndex)).toEqual([edge.faces[0]])
    expect(area(withStar[0]!.fills.stars)).toBeCloseTo(CIRCLE, 1)
    expect(withStar[0]!.lines.starRings).toHaveLength(1)
  })

  it('splits a star on an edge between both panels, whose parts make up the whole dot', () => {
    const arts = art([{ dir: onEdge, mag: 0 }], STARS)
    const parts = arts.filter((a) => area(a.fills.stars) > 0)
    expect(parts.map((a) => a.faceIndex).sort()).toEqual([...edge.faces].sort())
    for (const p of parts) expect(area(p.fills.stars)).toBeCloseTo(CIRCLE / 2, 1)
  })

  it('omits stars fainter than the limit', () => {
    const arts = art([{ dir: centre, mag: 5.5 }], STARS)
    expect(arts.every((a) => area(a.fills.stars) === 0)).toBe(true)
  })

  it('cuts a bright star inside a face as a hole, and engraves nothing there', () => {
    const arts = art(
      [
        { dir: centre, mag: 0 },
        { dir: normalize(add(centre, scale(onEdge, 0.2))), mag: 3 },
      ],
      HOLES,
    )
    const a = arts[edge.faces[0]]!
    expect(a.holes).toHaveLength(1)
    expect(ringArea(a.holes![0]!)).toBeCloseTo(CIRCLE, 1)
    // The fainter star is engraved; the hole's star is not.
    expect(area(a.fills.stars)).toBeCloseTo(CIRCLE, 1)
    expect(arts.filter((x) => x.faceIndex !== a.faceIndex).every((x) => !x.holes?.length)).toBe(
      true,
    )
  })

  it('leaves the part of an engraved star under a hole unengraved', () => {
    const near = normalize(add(centre, scale(onEdge, 0.02)))
    const [a] = art(
      [
        { dir: centre, mag: 0 },
        { dir: near, mag: 3 },
      ],
      HOLES,
    ).filter((x) => x.holes?.length)
    const engraved = area(a!.fills.stars)
    expect(engraved).toBeGreaterThan(0)
    expect(engraved).toBeLessThan(CIRCLE - 0.5)
  })

  it('shrinks holes by half the kerf, as cut paths', () => {
    const kerfMm = 0.2
    const [a] = art([{ dir: centre, mag: 0 }], HOLES, { kerfMm }).filter((x) => x.holes?.length)
    expect(ringArea(a!.holes![0]!)).toBeCloseTo(Math.PI * (1.5 - kerfMm / 2) ** 2, 1)
  })

  it('notches both panels with a hole on their shared edge', () => {
    const plain = art([], HOLES)
    const arts = art([{ dir: onEdge, mag: 0 }], HOLES)
    for (const f of edge.faces) {
      const a = arts[f]!
      expect(a.holes).toEqual([])
      expect(area(a.fills.stars)).toBe(0)
      const removed = ringArea(plain[f]!.outline) - ringArea(a.outline)
      expect(removed).toBeCloseTo(CIRCLE / 2, 1)
      expect(a.cutOutline).toEqual(a.outline) // kerf off
    }
    const untouched = arts.filter((a) => !edge.faces.includes(a.faceIndex))
    for (const a of untouched) expect(a.outline).toEqual(plain[a.faceIndex]!.outline)
  })

  it('keeps notched outlines inside the un-notched panel, so a nesting layout stays valid', () => {
    const plain = art([], HOLES)
    const arts = art([{ dir: onEdge, mag: 0 }], HOLES)
    for (const f of edge.faces) {
      const outer = plain[f]!.outline
      for (const p of arts[f]!.outline) {
        // Inside (or on) every edge of the convex un-notched outline, within Clipper's grid.
        outer.forEach((a, k) => {
          const b = outer[(k + 1) % outer.length]!
          const d =
            ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) /
            Math.hypot(b[0] - a[0], b[1] - a[1])
          expect(d).toBeGreaterThan(-0.002)
        })
      }
    }
  })

  it('engraves every star when holes are off', () => {
    const arts = art([{ dir: centre, mag: 0 }], STARS)
    expect(arts.every((a) => a.holes === undefined)).toBe(true)
  })
})

describe('Milky Way fill', () => {
  /** True if p is inside the rings (even-odd, as LightBurn and the preview fill them). */
  const insideRings = (rings: readonly (readonly Vec2[])[], [x, y]: Vec2) => {
    let inside = false
    for (const ring of rings) {
      ring.forEach(([x0, y0], i) => {
        const [x1, y1] = ring[(i + 1) % ring.length]!
        if (y0 > y !== y1 > y && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) inside = !inside
      })
    }
    return inside
  }
  /** Offsets of about 1° along each axis, to find points near the band's edge. */
  const NUDGES: readonly Vec3[] = [
    [0.017, 0, 0],
    [0, 0.017, 0],
    [0, 0, 0.017],
    [-0.017, 0, 0],
    [0, -0.017, 0],
    [0, 0, -0.017],
  ]
  /** Barycentric sample weights across a triangular face. */
  const WEIGHTS = [
    [1, 1, 1],
    [4, 1, 1],
    [1, 4, 1],
    [1, 1, 4],
  ] as const

  // The band wraps right round the sky; spherical clipping of rings that large used to fill the
  // wrong side or nothing (plan §15.6), so check the fill against containment point by point.
  it.each([false, true])(
    'fills inside the band, not beside it (mirrored: %s)',
    (mirrored) => {
      const data = mirrored ? mirrorSky(skyData) : skyData
      const band: MultiPolygon = {
        type: 'MultiPolygon',
        coordinates: data.milkyWay as Position[][][],
      }
      const solid = buildFrames(preset('pentakis-dodecahedron'))
      const k = 100 / longestEdge(solid)
      const map = prepareMap({}, { milkyWay: preparePolygons(data.milkyWay) })
      const arts = buildAllFaces(solid, map, {
        mmPerUnit: k,
        precisionMm: null,
        fills: { milkyWay: true },
      })
      let inBand = 0
      let checked = 0
      for (const face of solid.faces) {
        const rings = arts[face.index]!.fills.milkyWay ?? []
        const [a, b, c] = face.vertices2D as [Vec2, Vec2, Vec2]
        for (const [wa, wb, wc] of WEIGHTS) {
          const n = wa + wb + wc
          const q: Vec2 = [
            (wa * a[0] + wb * b[0] + wc * c[0]) / n,
            (wa * a[1] + wb * b[1] + wc * c[1]) / n,
          ]
          const dir = normalize(planePoint(face, q))
          const expected = geoContains(band, vec3ToLonLat(dir))
          // Skip points within ~1° of the band's edge, where clipping tolerance could decide.
          const nearEdge = NUDGES.some(
            (nudge) => geoContains(band, vec3ToLonLat(normalize(add(dir, nudge)))) !== expected,
          )
          if (nearEdge) continue
          expect(insideRings(rings, [q[0] * k, q[1] * k])).toBe(expected)
          checked++
          if (expected) inBand++
        }
      }
      // Enough samples on both sides for the check to mean something.
      expect(checked).toBeGreaterThan(150)
      expect(inBand).toBeGreaterThan(20)
      expect(checked - inBand).toBeGreaterThan(20)
    },
    20000,
  )
})
