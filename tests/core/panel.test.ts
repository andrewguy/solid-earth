import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { rotationBetween } from '@/core/geo/rotation'
import { dihedralGroups, faceEdges, vGap } from '@/core/panel'
import { ringArea } from '@/core/planar/clipper'
import { buildAllFaces, longestEdge, prepareMap } from '@/core/pipeline'
import { buildFrames, planePoint } from '@/core/polyhedron/faces'
import { PRESET_IDS, preset } from '@/core/polyhedron/presets'
import { gnomonic } from '@/core/project/gnomonic'
import { POLE_FALLBACK_RAD, northUpRotation, rotate2D } from '@/core/project/orientation'
import { rotate } from '@/core/quat'
import { type Vec2, type Vec3, add, angle, dot, length, normalize, scale, sub } from '@/core/vec3'

import { rotation, vecCloseTo } from '../arbitraries'

const Z: Vec3 = [0, 0, 1]

describe('dihedral angles and V-gaps', () => {
  it('icosahedron: one group of 30 edges at 138.19°, inner gap 0.714 t', () => {
    const groups = dihedralGroups(buildFrames(preset('icosahedron')), 3)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.edgeCount).toBe(30)
    expect(groups[0]!.dihedralDeg).toBeCloseTo(138.19, 2)
    expect(groups[0]!.vGapDeg).toBeCloseTo(41.81, 2) // plan §3
    expect(groups[0]!.innerGapMm).toBeCloseTo(2 * 3 * Math.sin((41.81 * Math.PI) / 360), 2)
  })

  it('cube: 90° everywhere, inner gap t·√2', () => {
    const [g] = dihedralGroups(buildFrames(preset('cube')), 5)
    expect(g!.dihedralDeg).toBeCloseTo(90, 9)
    expect(g!.innerGapMm).toBeCloseTo(5 * Math.SQRT2, 9)
  })

  it('truncated icosahedron: hexagon–hexagon and pentagon–hexagon groups', () => {
    const groups = dihedralGroups(buildFrames(preset('truncated-icosahedron')), 3)
    expect(groups.map((g) => g.edgeCount)).toEqual([60, 30])
    expect(groups[0]!.dihedralDeg).toBeCloseTo(142.62, 2) // pentagon–hexagon
    expect(groups[1]!.dihedralDeg).toBeCloseTo(138.19, 2) // hexagon–hexagon
  })

  it('zero thickness has no inner gap', () => {
    expect(vGap(2, 0).innerGapMm).toBe(0)
  })

  it.each(PRESET_IDS)('%s: face edges list each neighbour once, symmetrically', (id) => {
    const frames = buildFrames(preset(id))
    for (const face of frames.faces) {
      const edges = faceEdges(frames, face.index)
      expect(edges).toHaveLength(face.vertices.length)
      expect(new Set(edges.map((e) => e.neighbour)).size).toBe(edges.length)
      for (const e of edges) {
        expect(faceEdges(frames, e.neighbour).some((o) => o.neighbour === face.index)).toBe(true)
      }
    }
  })
})

/** Area centroid of the face polygon, as a direction. */
function centreDir(face: ReturnType<typeof buildFrames>['faces'][number]): [Vec2, Vec3] {
  const pts = face.vertices2D
  let a = 0
  let cx = 0
  let cy = 0
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length]!
    const c = x0 * y1 - x1 * y0
    a += c
    cx += (x0 + x1) * c
    cy += (y0 + y1) * c
  })
  const c2: Vec2 = [cx / (3 * a), cy / (3 * a)]
  return [c2, normalize(planePoint(face, c2))]
}

describe('north-up orientation', () => {
  it.each(PRESET_IDS)('%s: local north at the face centre points straight up', (id) => {
    const frames = buildFrames(preset(id))
    fc.assert(
      fc.property(rotation, (q) => {
        const north = rotate(q, Z)
        return frames.faces.every((face) => {
          const [c2, c] = centreDir(face)
          if (Math.min(angle(c, north), angle(c, scale(north, -1) as Vec3)) < POLE_FALLBACK_RAD) {
            return true
          }
          const t = sub(north, scale(c, dot(north, c)))
          const p = gnomonic(face, normalize(add(c, scale(t, 1e-4 / length(t)))))!
          const r = northUpRotation(face, north)
          const [dx, dy] = rotate2D([p[0] - c2[0], p[1] - c2[1]], r)
          return Math.abs(dx) < 1e-6 * Math.abs(dy) && dy > 0
        })
      }),
      { numRuns: 30 },
    )
  })

  it.each(PRESET_IDS)(
    '%s: with a pole at the face centre, the longest edge is the baseline',
    (id) => {
      const frames = buildFrames(preset(id))
      for (const face of frames.faces) {
        const [, c] = centreDir(face)
        for (const pole of [Z, [0, 0, -1] as Vec3]) {
          // Rotate the globe so this pole sits at the face centre.
          const q = rotationBetween(pole, c)
          const r = northUpRotation(face, rotate(q, Z))
          const out = face.vertices2D.map((p) => rotate2D(p, r))
          const minY = Math.min(...out.map((p) => p[1]))
          const lengths = out.map((p, k) => {
            const n = out[(k + 1) % out.length]!
            return Math.hypot(n[0] - p[0], n[1] - p[1])
          })
          const longest = Math.max(...lengths)
          const base = out.findIndex(
            (p, k) =>
              Math.abs(p[1] - minY) < 1e-9 && Math.abs(out[(k + 1) % out.length]![1] - minY) < 1e-9,
          )
          expect(base).toBeGreaterThanOrEqual(0)
          expect(lengths[base]).toBeCloseTo(longest, 9)
          // Interior above the baseline: it runs in +x on a CCW outline.
          expect(out[(base + 1) % out.length]![0]).toBeGreaterThan(out[base]![0])
        }
      }
    },
  )

  it('rotated artwork maps back onto the true face (continuity is preserved)', () => {
    const frames = buildFrames(preset('icosahedron'))
    const mmPerUnit = 100 / longestEdge(frames)
    fc.assert(
      fc.property(rotation, (q) => {
        const arts = buildAllFaces(frames, prepareMap({}), {
          mmPerUnit,
          precisionMm: null,
          north: rotate(q, Z),
        })
        return arts.every((art) =>
          art.outline.every((p, k) => {
            const back = rotate2D(p, -art.rotation)
            const v = frames.faces[art.faceIndex]!.vertices2D[k]!
            return vecCloseTo(back, [v[0] * mmPerUnit, v[1] * mmPerUnit], 1e-9)
          }),
        )
      }),
      { numRuns: 20 },
    )
  })
})

describe('kerf compensation', () => {
  const frames = buildFrames(preset('icosahedron'))
  const mmPerUnit = 100 / longestEdge(frames)
  const kerf = 0.2

  it('offsets the cut path outward by kerf/2 with sharp corners; engraving is untouched', () => {
    const [plain] = buildAllFaces(frames, prepareMap({}), { mmPerUnit, precisionMm: null })
    const [kerfed] = buildAllFaces(frames, prepareMap({}), {
      mmPerUnit,
      precisionMm: null,
      kerfMm: kerf,
    })
    expect(kerfed!.outline).toEqual(plain!.outline)
    expect(plain!.cutOutline).toEqual(plain!.outline)
    const cut = kerfed!.cutOutline
    expect(cut).toHaveLength(3) // mitred, so still a triangle
    // Each cut edge is parallel to an outline edge at distance kerf/2.
    const out = kerfed!.outline
    for (let k = 0; k < 3; k++) {
      const [a, b] = [out[k]!, out[(k + 1) % 3]!]
      const ex = b[0] - a[0]
      const ey = b[1] - a[1]
      const len = Math.hypot(ex, ey)
      const dists = cut.map(([x, y]) => (ex * (a[1] - y) - ey * (a[0] - x)) / len)
      // Two cut vertices lie on the offset line of this edge, kerf/2 outside it (with this
      // cross-product sign convention, outside a CCW outline is positive).
      const onLine = dists.filter((d) => Math.abs(d - kerf / 2) < 2e-3)
      expect(onLine.length).toBe(2)
    }
    expect(ringArea(cut)).toBeGreaterThan(ringArea(out))
  })
})
