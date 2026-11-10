import { geoArea } from 'd3-geo'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { clipRingToCone, sphericalRingArea } from '@/core/clip/polygon'
import { DEFAULT_SVG_OPTIONS, faceToSvg } from '@/core/export/svg'
import { prepareLines, preparePolygons } from '@/core/geo/lines'
import {
  type LakesTopology,
  type LandTopology,
  coastlineLines,
  graticuleLines,
  lakePolygons,
  landFeatures,
  landPolygons,
} from '@/core/geo/topojson'
import { DEFAULT_LAYER_STYLES, type LayerId, type LayerStyle } from '@/core/layers'
import { ringArea } from '@/core/planar/clipper'
import { buildAllFaces, longestEdge, prepareMap } from '@/core/pipeline'
import { buildFrames } from '@/core/polyhedron/faces'
import { PRESET_IDS, preset } from '@/core/polyhedron/presets'
import { rotate } from '@/core/quat'
import { type Vec2, type Vec3, add, cross, normalize, scale } from '@/core/vec3'
import lakes110m from '@/data/lakes-110m.topo.json'
import land110m from '@/data/land-110m.topo.json'

import { rotation, unitVec3 } from '../arbitraries'

const SPHERE = 4 * Math.PI
const ico = buildFrames(preset('icosahedron'))

/** A star-shaped (often concave) ring around `centre`, counter-clockwise seen from outside. */
const starRing = fc
  .tuple(
    unitVec3,
    fc.array(fc.double({ min: 0.05, max: 1, noNaN: true }), { minLength: 5, maxLength: 24 }),
  )
  .map(([centre, radii]): Vec3[] => {
    const a = normalize(cross(centre, Math.abs(centre[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
    const b = cross(centre, a)
    return radii.map((r, i) => {
      const t = (2 * Math.PI * i) / radii.length
      const tangent = add(scale(a, Math.cos(t)), scale(b, Math.sin(t)))
      return normalize(add(centre, scale(tangent, r))) // up to 45° from the centre
    })
  })

describe('spherical Sutherland–Hodgman', () => {
  it('keeps a ring inside the cone unchanged and drops one in the opposite cone', () => {
    const face = ico.faces[0]!
    const tiny = [0, 1, 2].map((k) => normalize(add(face.normal, scale(face.vertices[k]!, 0.01))))
    expect(clipRingToCone(tiny, face.edgePlanes)).toEqual(tiny)
    expect(
      clipRingToCone(
        tiny.map((p) => scale(p, -1) as Vec3),
        face.edgePlanes,
      ),
    ).toEqual([])
  })

  it.each(PRESET_IDS)('%s: clipped pieces add up to the original area', (id) => {
    const frames = buildFrames(preset(id))
    fc.assert(
      fc.property(starRing, (ring) => {
        const total = sphericalRingArea(ring)
        const pieces = frames.faces.reduce(
          (s, f) => s + sphericalRingArea(clipRingToCone(ring, f.edgePlanes)),
          0,
        )
        return Math.abs(pieces - total) < 1e-9
      }),
      { numRuns: 50 },
    )
  })

  it('real land (incl. Antarctica round the pole) clips to exactly d3’s land area', () => {
    const land = landFeatures(land110m as unknown as LandTopology)
    const rings = preparePolygons(landPolygons(land110m as unknown as LandTopology))
    fc.assert(
      fc.property(rotation, (q) => {
        let clipped = 0
        for (const face of ico.faces) {
          for (const poly of rings) {
            for (const ring of poly) {
              const r = ring.map((p) => rotate(q, p))
              clipped += sphericalRingArea(clipRingToCone(r, face.edgePlanes))
            }
          }
        }
        // d3 exteriors are clockwise from outside, so the signed total is negative.
        return Math.abs(-clipped - geoArea(land)) < 1e-6 * SPHERE
      }),
      { numRuns: 5 },
    )
    expect(geoArea(land) / SPHERE).toBeGreaterThan(0.27)
  })
})

describe('fill layers (icosahedron, 110m)', () => {
  const mmPerUnit = 100 / longestEdge(ico)
  const landRings = preparePolygons(landPolygons(land110m as unknown as LandTopology))
  const lakeRings = preparePolygons(lakePolygons(lakes110m as unknown as LakesTopology))
  const coast = prepareLines(coastlineLines(land110m as unknown as LandTopology))
  const area = (rings: readonly Vec2[][] | undefined) =>
    (rings ?? []).reduce((s, r) => s + ringArea(r), 0)

  it('land + ocean tile each face exactly (no lakes)', () => {
    const map = prepareMap({ coastlines: coast }, { land: landRings })
    const arts = buildAllFaces(ico, map, {
      mmPerUnit,
      precisionMm: null,
      fills: { land: true, ocean: true },
    })
    let landTotal = 0
    for (const art of arts) {
      const face = ringArea(art.outline)
      const land = area(art.fills.land)
      const ocean = area(art.fills.ocean)
      expect(land).toBeGreaterThanOrEqual(0)
      expect(ocean).toBeGreaterThanOrEqual(0)
      // Clipper works on a 1 µm grid, so allow 1e-4 relative.
      expect(Math.abs(land + ocean - face) / face).toBeLessThan(1e-4)
      landTotal += land
    }
    expect(landTotal).toBeGreaterThan(0)
  })

  it('subtracts lakes from land, and lakes lie inside the face', () => {
    const withLakes = prepareMap({ coastlines: coast }, { land: landRings, lakes: lakeRings })
    const noLakes = prepareMap({ coastlines: coast }, { land: landRings })
    const opts = { mmPerUnit, precisionMm: null, fills: { land: true, lakes: true } } as const
    const a = buildAllFaces(ico, withLakes, opts)
    const b = buildAllFaces(ico, noLakes, opts)
    const landWith = a.reduce((s, art) => s + area(art.fills.land), 0)
    const landWithout = b.reduce((s, art) => s + area(art.fills.land), 0)
    const lakes = a.reduce((s, art) => s + area(art.fills.lakes), 0)
    expect(lakes).toBeGreaterThan(0)
    expect(landWith).toBeLessThan(landWithout)
    for (const art of a) {
      const xs = art.outline.map((p) => p[0])
      const ys = art.outline.map((p) => p[1])
      for (const ring of art.fills.lakes ?? []) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-3)
          expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-3)
          expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-3)
          expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-3)
        }
      }
    }
  })

  it('skips fills that are not requested', () => {
    const map = prepareMap({ coastlines: coast }, { land: landRings, lakes: lakeRings })
    const [art] = buildAllFaces(ico, map, { mmPerUnit, precisionMm: 0.01 })
    expect(art!.fills).toEqual({})
  })
})

describe('graticule', () => {
  it('has 24 meridians (including −180°) and 11 parallels at 15°', () => {
    const lines = graticuleLines(15)
    expect(lines).toHaveLength(35)
    expect(lines.some((l) => l.every((p) => p[0] === -180))).toBe(true)
  })

  it('keeps the ±180° meridian when seams are kept', () => {
    const kept = prepareLines(graticuleLines(15), 0.5, { keepSeams: true })
    const dropped = prepareLines(graticuleLines(15))
    expect(kept.length).toBeGreaterThan(dropped.length)
  })
})

describe('SVG with fills', () => {
  const mmPerUnit = 100 / longestEdge(ico)
  const map = prepareMap(
    { coastlines: prepareLines(coastlineLines(land110m as unknown as LandTopology)) },
    { land: preparePolygons(landPolygons(land110m as unknown as LandTopology)) },
  )
  const arts = buildAllFaces(ico, map, { mmPerUnit, precisionMm: 0.01, fills: { land: true } })
  const art = arts.find((a) => (a.fills.land ?? []).length > 0)!
  const withLand = (patch: Partial<LayerStyle>): Record<LayerId, LayerStyle> => ({
    ...DEFAULT_LAYER_STYLES,
    coastlines: { ...DEFAULT_LAYER_STYLES.coastlines, enabled: false },
    land: { ...DEFAULT_LAYER_STYLES.land, enabled: true, ...patch },
  })

  it('fill mode: even-odd filled path in the LightBurn colour, no shore line', () => {
    const svg = faceToSvg(art, { ...DEFAULT_SVG_OPTIONS, styles: withLand({ mode: 'fill' }) })
    expect(svg).toMatch(
      /inkscape:label="Land">\s*<path d="M[^"]+Z" fill="#0000FF" fill-rule="evenodd"/,
    )
    expect(svg).not.toMatch(
      /inkscape:label="Land">[\s\S]*fill="none"[\s\S]*<\/g>\s*<g id="layer-cut"/,
    )
  })

  it('stroke mode: coastline arcs only, never the clipped polygon outline', () => {
    const svg = faceToSvg(art, { ...DEFAULT_SVG_OPTIONS, styles: withLand({ mode: 'stroke' }) })
    const group = /<g id="layer-land"[\s\S]*?<\/g>/.exec(svg)![0]
    expect(group).not.toContain('fill="#0000FF"')
    expect(group).toContain('fill="none" stroke="#0000FF"')
    expect(group).not.toContain('Z')
  })

  it('both: fill plus shore line in one layer group', () => {
    const svg = faceToSvg(art, { ...DEFAULT_SVG_OPTIONS, styles: withLand({ mode: 'both' }) })
    const group = /<g id="layer-land"[\s\S]*?<\/g>/.exec(svg)![0]
    expect(group).toContain('fill-rule="evenodd"')
    expect(group).toContain('fill="none" stroke="#0000FF"')
  })
})
