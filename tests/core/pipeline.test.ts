import { describe, expect, it } from 'vitest'

import { faceToSvg, DEFAULT_SVG_OPTIONS } from '@/core/export/svg'
import { densifyLonLat, prepareLines } from '@/core/geo/lines'
import { lonLatToVec3, vec3ToLonLat } from '@/core/geo/lonlat'
import {
  type CountriesTopology,
  type LandTopology,
  borderLines,
  coastlineLines,
} from '@/core/geo/topojson'
import { DEFAULT_LAYER_STYLES, type LineLayerId } from '@/core/layers'
import {
  type FaceArtwork,
  type PreparedMap,
  buildFaceArtwork,
  longestEdge,
  rotateMap,
} from '@/core/pipeline'
import { buildFrames, planePoint } from '@/core/polyhedron/faces'
import { icosahedron } from '@/core/polyhedron/presets'
import { gnomonic, inverseGnomonic } from '@/core/project/gnomonic'
import { type Quat, conjugate, multiply, normalizeQuat, rotate } from '@/core/quat'
import { type Vec2, type Vec3, cross, dot, length, normalize, scale } from '@/core/vec3'
import countries110m from '@/data/countries-110m.topo.json'
import land110m from '@/data/land-110m.topo.json'
import land50m from '@/data/land-50m.topo.json'

const frames = buildFrames(icosahedron())
const EDGE_MM = 100
const mmPerUnit = EDGE_MM / longestEdge(frames)

const map: PreparedMap = {
  lines: {
    coastlines: prepareLines(coastlineLines(land110m as unknown as LandTopology)),
    borders: prepareLines(borderLines(countries110m as unknown as CountriesTopology)),
  },
}

const LINE_LAYERS: LineLayerId[] = ['coastlines', 'borders']
const allPolylines = (art: FaceArtwork) => LINE_LAYERS.flatMap((id) => art.layers[id]!.polylines)

/** Rotation taking unit vector `from` onto unit vector `to`. */
function rotationBetween(from: Vec3, to: Vec3): Quat {
  const c = cross(from, to)
  const w = 1 + dot(from, to)
  return normalizeQuat([c[0], c[1], c[2], w])
}

/** Signed distance (mm) of p inside a CCW convex polygon; ≥ 0 means inside. */
function insideDistance(outline: readonly Vec2[], p: Vec2): number {
  let min = Infinity
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    min = Math.min(min, (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / Math.hypot(ex, ey))
  })
  return min
}

describe('buildFaceArtwork (icosahedron, 110m)', () => {
  const arts = frames.faces.map((_, i) =>
    buildFaceArtwork(frames, i, map, { mmPerUnit, precisionMm: 0.01 }),
  )

  it('scales the outline to the requested edge length', () => {
    for (const art of arts) {
      art.outline.forEach((a, i) => {
        const b = art.outline[(i + 1) % art.outline.length]!
        expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(EDGE_MM, 1)
      })
    }
  })

  it('keeps every output point inside its face (within rounding)', () => {
    for (const art of arts) {
      for (const pl of allPolylines(art)) {
        for (const p of pl) expect(insideDistance(art.outline, p)).toBeGreaterThan(-0.01)
      }
    }
  })

  it('produces linework on most faces', () => {
    const withLines = arts.filter((a) => allPolylines(a).length > 0).length
    expect(withLines).toBeGreaterThanOrEqual(15)
  })

  it('outputs rounded, de-duplicated points', () => {
    for (const art of arts) {
      for (const pl of allPolylines(art)) {
        pl.forEach((p, i) => {
          expect(Math.round(p[0] * 100) / 100).toBe(p[0])
          if (i > 0) expect(p).not.toEqual(pl[i - 1])
        })
      }
    }
  })

  it('features crossing an edge meet at the same 3D point from both faces', () => {
    // Unrounded, to test the geometry itself; rounding adds ≤ 0.0071 mm per point.
    const exact = frames.faces.map((_, i) =>
      buildFaceArtwork(frames, i, map, { mmPerUnit, precisionMm: null }),
    )
    let matched = 0
    for (const edge of frames.edges) {
      const [fa, fb] = edge.faces
      const endpoints = (fi: number) => {
        const face = frames.faces[fi]!
        return allPolylines(exact[fi]!)
          .flatMap((pl) => [pl[0]!, pl[pl.length - 1]!])
          .map((p) => planePoint(face, [p[0] / mmPerUnit, p[1] / mmPerUnit]))
      }
      const a = endpoints(fa)
      const b = endpoints(fb)
      // Endpoints of A that lie on the shared edge line (in 3D, scaled to mm).
      const va = frames.def.vertices[edge.a]!
      const vb = frames.def.vertices[edge.b]!
      const dir = normalize([vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]])
      const onEdge = a.filter((p) => {
        const r: Vec3 = [p[0] - va[0], p[1] - va[1], p[2] - va[2]]
        return length(cross(r, dir)) * mmPerUnit < 1e-6
      })
      for (const p of onEdge) {
        const best = Math.min(
          ...b.map((q) => length([p[0] - q[0], p[1] - q[1], p[2] - q[2]]) * mmPerUnit),
        )
        expect(best).toBeLessThan(1e-9)
        matched++
      }
    }
    expect(matched).toBeGreaterThan(50)
  })
})

describe('panel handedness', () => {
  it('is not mirrored: east → north turns counter-clockwise on every face, as on a map', () => {
    for (const face of frames.faces) {
      const [lon, lat] = vec3ToLonLat(face.normal)
      const c = gnomonic(face, lonLatToVec3(lon, lat))!
      const e = gnomonic(face, lonLatToVec3(lon + 0.1, lat))!
      const n = gnomonic(face, lonLatToVec3(lon, lat + 0.1))!
      const crossZ = (e[0] - c[0]) * (n[1] - c[1]) - (e[1] - c[1]) * (n[0] - c[0])
      expect(crossZ).toBeGreaterThan(0)
    }
  })
})

describe('seams on faces centred at 180°E and 90°S (50m coastlines)', () => {
  const face = frames.faces[0]!
  const coast50m = coastlineLines(land50m as unknown as LandTopology)
  const withSeamRemoval: PreparedMap = { lines: { coastlines: prepareLines(coast50m) } }
  // Negative control: same pipeline without seam removal.
  const withoutSeamRemoval: PreparedMap = {
    lines: {
      coastlines: coast50m.map((l) => densifyLonLat(l).map((p) => lonLatToVec3(p[0]!, p[1]!))),
    },
  }

  /** Count output segments that map back to a seam (antimeridian run or south-pole edge). */
  function seamSegments(source: PreparedMap, target: Vec3): number {
    // Rotate the globe so `target` sits at face 0's centre, plus an arbitrary roll.
    const roll: Quat = normalizeQuat([...scale(face.normal, Math.sin(0.3)), Math.cos(0.3)])
    const q = multiply(roll, rotationBetween(target, face.normal))
    const art = buildFaceArtwork(frames, 0, rotateMap(source, q), { mmPerUnit, precisionMm: null })
    const back = (p: Vec2) =>
      vec3ToLonLat(
        rotate(conjugate(q), inverseGnomonic(face, [p[0] / mmPerUnit, p[1] / mmPerUnit])),
      )
    const isSeam = (a: number[], b: number[]) =>
      (Math.abs(a[0]!) > 179.9999 && Math.abs(b[0]!) > 179.9999 && a[0]! * b[0]! > 0) ||
      (a[1]! < -89.99 && b[1]! < -89.99)
    let count = 0
    for (const pl of art.layers.coastlines!.polylines) {
      const ll = pl.map(back)
      for (let i = 1; i < ll.length; i++) if (isSeam(ll[i - 1]!, ll[i]!)) count++
    }
    return count
  }

  it.each([
    ['180°E', lonLatToVec3(180, 0)],
    ['90°S', lonLatToVec3(0, -90)],
  ])('face centred at %s has no seam lines', (_name, target) => {
    expect(seamSegments(withoutSeamRemoval, target)).toBeGreaterThan(0)
    expect(seamSegments(withSeamRemoval, target)).toBe(0)
  })
})

describe('faceToSvg', () => {
  const art = buildFaceArtwork(frames, 0, map, { mmPerUnit, precisionMm: 0.01 })
  const svg = faceToSvg(art, { ...DEFAULT_SVG_OPTIONS, styles: DEFAULT_LAYER_STYLES })

  it('declares real mm size with a matching viewBox', () => {
    const m = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
    expect(m).not.toBeNull()
    const [, w, h, vw, vh] = m!
    expect(w).toBe(vw)
    expect(h).toBe(vh)
    // Equilateral triangle, 100 mm edge, plus 1 mm margin each side (either orientation).
    const dims = [Number(w), Number(h)].sort((x, y) => x - y)
    expect(dims[0]).toBeGreaterThan(80)
    expect(dims[1]).toBeCloseTo(102, 1)
  })

  it('emits Inkscape layers with exact LightBurn colours', () => {
    expect(svg).toContain('inkscape:groupmode="layer" inkscape:label="Cut"')
    expect(svg).toContain('stroke="#FF0000"')
    expect(svg).toMatch(/inkscape:label="Coastlines">\s*<path [^>]*stroke="#000000"/)
    expect(svg).not.toContain('fill="#')
  })

  it('keeps all coordinates inside the viewBox with ≤ 2 decimals', () => {
    const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.map(Number)
    for (const d of svg.matchAll(/ d="([^"]+)"/g)) {
      const nums = d[1]!.split(/[MLZ ]/).filter(Boolean)
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toMatch(/^\d+(\.\d{1,2})?$/)
        const x = Number(nums[i])
        const y = Number(nums[i + 1])
        expect(x).toBeGreaterThanOrEqual(0)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(w!)
        expect(y).toBeLessThanOrEqual(h!)
      }
    }
  })

  it('omits disabled layers', () => {
    const noBorders = faceToSvg(art, {
      ...DEFAULT_SVG_OPTIONS,
      styles: {
        ...DEFAULT_LAYER_STYLES,
        borders: { ...DEFAULT_LAYER_STYLES.borders, enabled: false },
      },
    })
    expect(noBorders).not.toContain('layer-borders')
  })
})
