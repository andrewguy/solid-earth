import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { JointOptions } from '@/core/joints'
import { congruences, convexHull, rot } from '@/core/nest/convex'
import {
  HULL_TOL_MM,
  MATCH_TOL_MM,
  type NestPart,
  type PreparedParts,
  binFor,
  fitsBin,
  placePoint,
  prepareParts,
  referenceOutline,
  toPlacement,
} from '@/core/nest/parts'
import { DEFAULT_NEST_SETTINGS, type NestSettings, ROTATION_MODES } from '@/core/nest/types'
import { type PanelShape, panelShapes } from '@/core/panel-shape'
import { longestEdge } from '@/core/pipeline'
import { buildFrames } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import { type Vec2, type Vec3, normalize } from '@/core/vec3'

const NORTH: Vec3 = normalize([0.3, -0.2, 0.9])
const FINGER: JointOptions = { kind: 'finger', widthMm: 10, tip: 'fill', clearanceMm: 0.1 }
const BIG: NestSettings = { ...DEFAULT_NEST_SETTINGS, sheetWidthMm: 2000, sheetHeightMm: 2000 }

function panels(shape: PresetId, opts: { joint?: JointOptions; thicknessMm?: number } = {}) {
  const frames = buildFrames(preset(shape))
  return panelShapes(frames, {
    mmPerUnit: 100 / longestEdge(frames),
    thicknessMm: opts.thicknessMm ?? 3,
    joint: opts.joint ?? { kind: 'butt' },
    kerfMm: 0.15,
    north: NORTH,
  })
}

/** Smallest signed distance from p to the edges of a CCW convex polygon; ≥ 0 inside. */
function insideDistance(poly: readonly Vec2[], [x, y]: Vec2): number {
  let d = Infinity
  poly.forEach(([ax, ay], k) => {
    const [bx, by] = poly[(k + 1) % poly.length]!
    const len = Math.hypot(bx - ax, by - ay)
    d = Math.min(d, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len)
  })
  return d
}

const isStrictlyConvexCcw = (poly: readonly Vec2[]) =>
  poly.every((p, k) => {
    const q = poly[(k + 1) % poly.length]!
    const r = poly[(k + 2) % poly.length]!
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) > 0
  })

/** Canonical polygon of a part in its reference frame: R(phi) · c + t. */
const partPolygon = (prep: PreparedParts, part: NestPart) =>
  prep.shapes[part.shape]!.polygon.map((p): Vec2 => {
    const [x, y] = rot(p, part.phi)
    return [x + part.t[0], y + part.t[1]]
  })

const byFace = (list: readonly PanelShape[]) => new Map(list.map((p) => [p.faceIndex, p]))

describe('convexHull', () => {
  // Coordinates on a 0.1 grid: subnormal doubles would underflow the convexity test itself.
  const coord = fc.integer({ min: -1000, max: 1000 }).map((i) => i / 10)
  const point = fc.tuple(coord, coord)
  it('is strictly convex, CCW, and contains every point', () => {
    fc.assert(
      fc.property(fc.array(point, { minLength: 3, maxLength: 40 }), (pts) => {
        let hull: Vec2[]
        try {
          hull = convexHull(pts, 1e-6)
        } catch {
          return // all points (nearly) collinear
        }
        expect(isStrictlyConvexCcw(hull)).toBe(true)
        for (const p of pts) expect(insideDistance(hull, p)).toBeGreaterThan(-1e-6)
      }),
    )
  })

  it('drops collinear and near-collinear vertices', () => {
    const hull = convexHull(
      [
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 5.00000001],
        [10, 10],
        [0, 10],
        [5, 5],
      ],
      HULL_TOL_MM,
    )
    expect(hull).toHaveLength(4)
  })
})

describe('congruences', () => {
  const quad: Vec2[] = [
    [0, 0],
    [4, 0],
    [5, 3],
    [1, 2],
  ]
  it('finds the rigid motion between moved copies', () => {
    const r = 1.234
    const moved = quad.map((p): Vec2 => {
      const [x, y] = rot(p, r)
      return [x + 7, y - 3]
    })
    // Start at a different vertex too.
    const shifted = [...moved.slice(2), ...moved.slice(0, 2)]
    const [m, ...rest] = congruences(quad, shifted, 1e-9)
    expect(rest).toEqual([])
    expect(m!.rotation).toBeCloseTo(r, 12)
    expect(m!.translation[0]).toBeCloseTo(7, 12)
    expect(m!.translation[1]).toBeCloseTo(-3, 12)
  })

  it('never matches a mirror image', () => {
    const mirrored = quad.map(([x, y]): Vec2 => [-x, y]).reverse() // reversed to stay CCW
    expect(congruences(quad, mirrored, 1e-6)).toEqual([])
  })

  it('counts rotational symmetry', () => {
    const regular = (n: number) =>
      Array.from({ length: n }, (_, k): Vec2 => rot([10, 0], (2 * Math.PI * k) / n))
    const rect: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [0, 1],
    ]
    expect(congruences(regular(3), regular(3), 1e-9)).toHaveLength(3)
    expect(congruences(regular(6), regular(6), 1e-9)).toHaveLength(6)
    expect(congruences(rect, rect, 1e-9)).toHaveLength(2)
    expect(congruences(quad, quad, 1e-9)).toHaveLength(1)
  })
})

describe('prepareParts', () => {
  it.each<[PresetId, JointOptions | undefined, number | undefined, number[]]>([
    ['icosahedron', undefined, undefined, [3]],
    ['cube', undefined, undefined, [4]],
    ['truncated-icosahedron', undefined, undefined, [5, 3]], // hexagon insets alternate
    ['truncated-icosahedron', undefined, 0, [5, 6]],
    ['rhombic-triacontahedron', FINGER, undefined, [2]],
    ['pentagonal-icositetrahedron', FINGER, undefined, [1]], // chiral, still one shape
    ['snub-cube', undefined, 0, [3, 4]],
    // With thickness, the 24 triangles touching a square get a deeper inset on that edge. Their
    // edges keep their directions, so they stay equilateral, just smaller: a third shape.
    ['snub-cube', undefined, undefined, [3, 3, 4]],
  ])('groups %s (%o, t=%s) into shapes with symmetries %o', (shape, joint, t, symmetries) => {
    const prep = prepareParts(panels(shape, { joint, thicknessMm: t }), BIG)
    expect(prep.shapes.map((s) => s.symmetry).sort()).toEqual([...symmetries].sort())
    // Distinct shapes really are distinct.
    for (const [i, a] of prep.shapes.entries()) {
      for (const b of prep.shapes.slice(i + 1)) {
        expect(congruences(a.polygon, b.polygon, MATCH_TOL_MM)).toEqual([])
      }
    }
    expect(prep.parts.length + prep.unplaced.length).toBe(buildFrames(preset(shape)).faces.length)
    expect(prep.unplaced).toEqual([])
  })

  it.each(ROTATION_MODES)('keeps every cut path at least gap/2 inside its shape (%s)', (mode) => {
    for (const shape of ['truncated-icosahedron', 'rhombic-triacontahedron'] as const) {
      const list = panels(shape, { joint: FINGER })
      const nest = { ...BIG, rotationMode: mode, gapMm: 3 }
      const prep = prepareParts(list, nest)
      const faces = byFace(list)
      for (const s of prep.shapes) expect(isStrictlyConvexCcw(s.polygon)).toBe(true)
      for (const part of prep.parts) {
        const poly = partPolygon(prep, part)
        for (const p of referenceOutline(faces.get(part.face)!, mode)) {
          expect(insideDistance(poly, p)).toBeGreaterThan(nest.gapMm / 2 - 1e-6)
        }
      }
    }
  })

  it.each(ROTATION_MODES)('places outlines where the nester put the shape (%s)', (mode) => {
    const list = panels('icosahedron', { joint: FINGER })
    const prep = prepareParts(list, { ...BIG, rotationMode: mode })
    const faces = byFace(list)
    for (const part of prep.parts) {
      const canonical = prep.shapes[part.shape]!.polygon
      for (const angle of part.angles) {
        const T: Vec2 = [321.5, 123.25]
        const placed = canonical.map((p): Vec2 => {
          const [x, y] = rot(p, angle.alpha)
          return [x + T[0], y + T[1]]
        })
        const placement = toPlacement(part, 0, angle, T)
        expect(placement.angleDeg * (Math.PI / 180)).toBeCloseTo(angle.theta, 12)
        for (const p of referenceOutline(faces.get(part.face)!, mode)) {
          expect(insideDistance(placed, placePoint(p, placement))).toBeGreaterThan(1 - 1e-6)
        }
      }
    }
  })

  it('offers the right orientations per rotation mode', () => {
    const tri = panels('icosahedron')
    const square = panels('cube')
    const thetas = (list: PanelShape[], patch: Partial<NestSettings>) => {
      const prep = prepareParts(list, { ...BIG, ...patch })
      const sets = prep.parts.map((p) =>
        p.angles.map((a) => Math.round((a.theta * 180) / Math.PI)).sort((a, b) => a - b),
      )
      return { prep, sets }
    }
    // Free: the step grid within one symmetry period, the same alphas for every part.
    const free = thetas(tri, { rotationMode: 'free', rotationStepDeg: 15 })
    for (const p of free.prep.parts) {
      expect(p.angles.map((a) => Math.round((a.alpha * 180) / Math.PI))).toEqual([
        0, 15, 30, 45, 60, 75, 90, 105,
      ])
    }
    // Restricted modes: only the allowed reference angles, deduplicated by symmetry.
    for (const set of thetas(tri, { rotationMode: 'none' }).sets) expect(set).toEqual([0])
    for (const set of thetas(tri, { rotationMode: '180' }).sets) expect(set).toEqual([0, 180])
    for (const set of thetas(tri, { rotationMode: '90' }).sets)
      expect(set).toEqual([0, 90, 180, 270])
    for (const set of thetas(square, { rotationMode: '90' }).sets) expect(set).toEqual([0])
    for (const set of thetas(square, { rotationMode: '180' }).sets) expect(set).toEqual([0])
  })

  it('uses the north-up frame only in restricted modes', () => {
    const [p] = panels('icosahedron')
    expect(referenceOutline(p!, 'free')).toEqual(p!.cutOutline)
    const up = referenceOutline(p!, 'none')
    expect(up[0]![0]).toBeCloseTo(rot(p!.cutOutline[0]!, p!.rotation)[0], 12)
  })

  it('drops angles that do not fit, and lists faces that fit at none', () => {
    const tri = panels('icosahedron')
    // About 96 mm triangles: this bin is 112 × 87 mm, so wide-and-short orientations only.
    const narrow = { ...BIG, sheetWidthMm: 122, sheetHeightMm: 97, rotationStepDeg: 5 }
    const prep = prepareParts(tri, narrow)
    expect(prep.unplaced).toEqual([])
    const bin = binFor(narrow)
    for (const part of prep.parts) {
      expect(part.angles.length).toBeGreaterThan(0)
      expect(part.angles.length).toBeLessThan(24) // 120° / 5°
      for (const a of part.angles) {
        expect(fitsBin(prep.shapes[part.shape]!.polygon, a.alpha, bin)).toBe(true)
      }
    }
    const tiny = prepareParts(tri, { ...BIG, sheetWidthMm: 60, sheetHeightMm: 60 })
    expect(tiny.parts).toEqual([])
    expect(tiny.unplaced).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('lets the gap reach past the sheet edge when the margin is smaller than gap/2', () => {
    expect(binFor({ ...BIG, marginMm: 0, gapMm: 2 })).toEqual({
      minX: -1,
      minY: -1,
      maxX: 2001,
      maxY: 2001,
    })
  })
})
