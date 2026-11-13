import { geoContains } from 'd3-geo'
import type { Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'

import { isSeamSegment, prepareLines, preparePolygons } from '@/core/geo/lines'
import { lonLatToVec3, vec3ToLonLat } from '@/core/geo/lonlat'
import {
  MOON_RADIUS_KM,
  type MoonData,
  craterCount,
  craterRims,
  mariaOutlines,
} from '@/core/geo/moon'
import { buildAllFaces, longestEdge, prepareMap, rotateMap } from '@/core/pipeline'
import { buildFrames, planePoint } from '@/core/polyhedron/faces'
import { preset } from '@/core/polyhedron/presets'
import { type Quat, fromAxisAngle, rotate } from '@/core/quat'
import { type Vec2, type Vec3, add, angle, normalize } from '@/core/vec3'
import moonJson from '@/data/moon.json'

const moon = moonJson as unknown as MoonData

describe('crater rims', () => {
  const craters = [
    [-20.08, 9.62, 96], // Copernicus
    [180, 89.9, 40], // near the pole, on the antimeridian
    [0, 0, 12],
  ].flat()

  it('are closed rings close to the crater’s true angular radius, each slightly out of round', () => {
    const rims = craterRims(craters, 10)
    expect(rims).toHaveLength(3)
    rims.forEach((rim, i) => {
      const [lon, lat, d] = craters.slice(i * 3, i * 3 + 3) as [number, number, number]
      const c = lonLatToVec3(lon, lat)
      expect(rim[0]).toEqual(rim.at(-1))
      expect(rim.length - 1).toBeGreaterThanOrEqual(24)
      expect(rim.length - 1).toBeLessThanOrEqual(96)
      // Within the rim harmonics' total amplitude (≤ 11.5 %), and not a perfect circle.
      const rho = d / 2 / MOON_RADIUS_KM
      const ratios = rim.map((p) => angle(p, c) / rho)
      for (const q of ratios) expect(Math.abs(q - 1)).toBeLessThan(0.116)
      expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(1e-4)
    })
  })

  it('leave out craters smaller than the limit', () => {
    expect(craterRims(craters, 30)).toHaveLength(2)
    expect(craterRims(craters, 100)).toHaveLength(0)
    expect(craterCount(craters, 30)).toBe(2)
    expect(craterCount(moon.craters, 30)).toBe(2301)
    expect(craterRims(moon.craters, 30)).toHaveLength(2301)
  })

  it('draw a crater on two panels when it straddles their edge', () => {
    const frames = buildFrames(preset('icosahedron'))
    const edge = frames.edges[0]!
    const v = frames.def.vertices
    const [lon, lat] = vec3ToLonLat(normalize(add(v[edge.a]!, v[edge.b]!)))
    const arts = buildAllFaces(frames, prepareMap({ craters: craterRims([lon, lat, 200], 10) }), {
      mmPerUnit: 100 / longestEdge(frames),
      precisionMm: null,
    })
    const drawn = arts.filter((a) => (a.lines.craters ?? []).length > 0).map((a) => a.faceIndex)
    expect(drawn.sort()).toEqual([...edge.faces].sort())
  })
})

describe('maria outlines', () => {
  const lines = mariaOutlines(moon)

  it('stroke every maria ring', () => {
    const points = (ls: readonly (readonly unknown[])[]) => ls.reduce((s, l) => s + l.length, 0)
    const rings = moon.maria.flat()
    // Only the seam's own vertices may go (each split ring loses at most its seam run).
    expect(points(lines)).toBeGreaterThan(points(rings) - 50)
    expect(lines.length).toBeGreaterThanOrEqual(rings.length)
  })

  it('leave out the antimeridian seam of the one mare split there', () => {
    const seams = lines.flatMap((l) => l.slice(1).filter((b, i) => isSeamSegment(l[i]!, b)))
    expect(seams).toEqual([])
    const touching = moon.maria.flat().filter((r) => r.some((p) => Math.abs(p[0]!) === 180))
    expect(touching).toHaveLength(2)
    expect(prepareLines(lines, 0.5, { keepSeams: true }).length).toBe(lines.length)
  })
})

describe('maria fill', () => {
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
  /** Offsets of about 1° along each axis, to find points near a mare's edge. */
  const NUDGES: readonly Vec3[] = [
    [0.017, 0, 0],
    [0, 0.017, 0],
    [0, 0, 0.017],
    [-0.017, 0, 0],
    [0, -0.017, 0],
    [0, 0, -0.017],
  ]
  const map = prepareMap({}, { maria: preparePolygons(moon.maria) })
  // Containment per polygon, skipping polygons whose lon/lat box misses the point (the maria
  // never cross the antimeridian, and a merged region's polygons never overlap): testing the
  // whole region at every sample is far too slow.
  const boxes = moon.maria.map((rings) => {
    const lons = rings[0]!.map((p) => p[0]!)
    const lats = rings[0]!.map((p) => p[1]!)
    return {
      polygon: { type: 'Polygon', coordinates: rings } as Polygon,
      box: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    }
  })
  const contains = (dir: Vec3) => {
    const [lon, lat] = vec3ToLonLat(dir)
    return boxes.some(
      ({ polygon, box }) =>
        lon >= box[0]! &&
        lat >= box[1]! &&
        lon <= box[2]! &&
        lat <= box[3]! &&
        geoContains(polygon, [lon, lat]),
    )
  }

  // Oceanus Procellarum is the largest ring; spherical clipping of very large rings filled the
  // wrong side of the Milky Way (plan §15.6), so check the fill against containment point by
  // point, on large faces (cube) and small ones, turned so the near side straddles edges.
  it.each([
    ['cube', 0],
    ['cube', 0.7],
    ['pentakis-dodecahedron', 0],
    ['pentakis-dodecahedron', 0.3],
  ] as const)(
    'fills inside the maria, not beside them (%s, turned %s rad)',
    (shape, turn) => {
      const q: Quat = fromAxisAngle(normalize([1, 2, 3]), turn)
      const inverse: Quat = [-q[0], -q[1], -q[2], q[3]]
      const solid = buildFrames(preset(shape))
      const k = 100 / longestEdge(solid)
      const arts = buildAllFaces(solid, rotateMap(map, q), {
        mmPerUnit: k,
        precisionMm: null,
        fills: { maria: true },
      })
      let inMaria = 0
      let checked = 0
      const steps = shape === 'cube' ? 12 : 5
      for (const face of solid.faces) {
        const rings = arts[face.index]!.fills.maria ?? []
        const vs = face.vertices2D
        const centre = vs.reduce<Vec2>(
          (s, p) => [s[0] + p[0] / vs.length, s[1] + p[1] / vs.length],
          [0, 0],
        )
        // Sample a grid of points across the face, by interpolating towards each vertex pair.
        for (let e = 0; e < vs.length; e++) {
          const a = vs[e]!
          const b = vs[(e + 1) % vs.length]!
          for (let i = 1; i < steps; i++) {
            for (let j = 1; j < steps - i; j++) {
              const wa = i / steps
              const wb = j / steps
              const q2: Vec2 = [
                centre[0] + wa * (a[0] - centre[0]) + wb * (b[0] - centre[0]),
                centre[1] + wa * (a[1] - centre[1]) + wb * (b[1] - centre[1]),
              ]
              const dir = rotate(inverse, normalize(planePoint(face, q2)))
              const expected = contains(dir)
              if (NUDGES.some((n) => contains(normalize(add(dir, n))) !== expected)) continue
              expect(insideRings(rings, [q2[0] * k, q2[1] * k])).toBe(expected)
              checked++
              if (expected) inMaria++
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(300)
      expect(inMaria).toBeGreaterThan(30)
      expect(checked - inMaria).toBeGreaterThan(30)
    },
    30000,
  )
})
