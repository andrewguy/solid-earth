import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { JointOptions } from '@/core/joints'
import { convexHull, rot } from '@/core/nest/convex'
import { NfpCache, convexNfp, growConvex, minkowskiConvex, rectIfp } from '@/core/nest/nfp'
import { prepareParts } from '@/core/nest/parts'
import { DEFAULT_NEST_SETTINGS, type NestSettings } from '@/core/nest/types'
import { panelShapes } from '@/core/panel-shape'
import { longestEdge } from '@/core/pipeline'
import { ringArea } from '@/core/planar/clipper'
import { buildFrames } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import type { Vec2 } from '@/core/vec3'

// Coordinates on a 0.1 grid keep hulls well-conditioned.
const coord = fc.integer({ min: -500, max: 500 }).map((i) => i / 10)
const convexPolygon = fc
  .array(fc.tuple(coord, coord), { minLength: 3, maxLength: 12 })
  .map((pts) => {
    try {
      return convexHull(pts, 1e-9)
    } catch {
      return null
    }
  })
  .filter((p): p is Vec2[] => p !== null && Math.abs(ringArea(p)) > 1)

const translate = (poly: readonly Vec2[], [tx, ty]: Vec2) =>
  poly.map(([x, y]): Vec2 => [x + tx, y + ty])

/** Smallest signed distance from p to the edges of a CCW convex polygon; ≥ 0 inside. */
function insideDistance(poly: readonly Vec2[], [x, y]: Vec2): number {
  let d = Infinity
  poly.forEach(([ax, ay], k) => {
    const [bx, by] = poly[(k + 1) % poly.length]!
    d = Math.min(d, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay))
  })
  return d
}

/** Distance from p to a convex polygon's boundary, signed: negative inside. */
function boundaryDistance(poly: readonly Vec2[], p: Vec2): number {
  let d = Infinity
  poly.forEach((a, k) => {
    const b = poly[(k + 1) % poly.length]!
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]]
    const u = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)),
    )
    d = Math.min(d, Math.hypot(p[0] - a[0] - u * ex, p[1] - a[1] - u * ey))
  })
  return insideDistance(poly, p) > 0 ? -d : d
}

/** Area of the intersection of two convex CCW polygons (Sutherland–Hodgman). */
function overlapArea(a: readonly Vec2[], b: readonly Vec2[]): number {
  let out: Vec2[] = [...a]
  b.forEach((p, k) => {
    const q = b[(k + 1) % b.length]!
    const side = ([x, y]: Vec2) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    const input = out
    out = []
    input.forEach((s, i) => {
      const e = input[(i + 1) % input.length]!
      const ds = side(s)
      const de = side(e)
      if (ds >= 0) out.push(s)
      if (ds >= 0 !== de >= 0) {
        const r = ds / (ds - de)
        out.push([s[0] + r * (e[0] - s[0]), s[1] + r * (e[1] - s[1])])
      }
    })
  })
  return out.length >= 3 ? Math.abs(ringArea(out)) : 0
}

/** Separation of two disjoint convex polygons (closest vertex–edge pair). */
function separation(a: readonly Vec2[], b: readonly Vec2[]): number {
  let d = Infinity
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const v of p) d = Math.min(d, Math.abs(boundaryDistance(q, v)))
  }
  return d
}

const isConvexCcw = (poly: readonly Vec2[]) =>
  poly.every((p, k) => {
    const q = poly[(k + 1) % poly.length]!
    const r = poly[(k + 2) % poly.length]!
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) >= -1e-9
  })

/** Same convex region: equal areas and each one's vertices on or inside the other. */
function expectSameRegion(a: readonly Vec2[], b: readonly Vec2[], tol = 1e-6) {
  expect(ringArea(a)).toBeCloseTo(ringArea(b), 6)
  for (const p of a) expect(insideDistance(b, p)).toBeGreaterThan(-tol)
  for (const p of b) expect(insideDistance(a, p)).toBeGreaterThan(-tol)
}

describe('minkowskiConvex', () => {
  it('is convex and CCW, with at most n + m vertices, and equals the hull of all vertex sums', () => {
    // For convex polygons the Minkowski sum is, by definition, the hull of the pairwise sums.
    // (Clipper2's minkowskiSum is not a usable oracle: it sweeps the outline rather than the
    // filled polygon, and under-covers thin slivers even on its outer boundary.)
    fc.assert(
      fc.property(convexPolygon, convexPolygon, (P, Q) => {
        const sum = minkowskiConvex(P, Q)
        expect(sum.length).toBeLessThanOrEqual(P.length + Q.length)
        expect(isConvexCcw(sum)).toBe(true)
        const sums = P.flatMap(([px, py]) => Q.map(([qx, qy]): Vec2 => [px + qx, py + qy]))
        expectSameRegion(sum, convexHull(sums, 1e-12), 1e-9)
      }),
      { numRuns: 300 },
    )
  })

  it('adds two unit squares into a 2 × 2 square', () => {
    const sq: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    expect(minkowskiConvex(sq, sq)).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ])
  })
})

describe('convexNfp', () => {
  const tPoint = fc.tuple(
    fc.double({ min: -150, max: 150, noNaN: true }),
    fc.double({ min: -150, max: 150, noNaN: true }),
  )

  it('separates overlap (inside) from clearance (outside), by exactly the boundary distance', () => {
    fc.assert(
      fc.property(convexPolygon, convexPolygon, tPoint, (A, B, T) => {
        const nfp = convexNfp(A, B)
        const d = boundaryDistance(nfp, T)
        const moved = translate(B, T)
        if (d < -1e-3) {
          expect(overlapArea(A, moved)).toBeGreaterThan(0)
        } else if (d > 1e-3) {
          expect(overlapArea(A, moved)).toBeLessThan(1e-9)
          expect(separation(A, moved)).toBeCloseTo(d, 6)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('makes the parts touch, without overlap, anywhere on the boundary', () => {
    fc.assert(
      fc.property(
        convexPolygon,
        convexPolygon,
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (A, B, edge, u) => {
          const nfp = convexNfp(A, B)
          const p = nfp[edge % nfp.length]!
          const q = nfp[(edge + 1) % nfp.length]!
          const T: Vec2 = [p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])]
          const moved = translate(B, T)
          expect(overlapArea(A, moved)).toBeLessThan(1e-6)
          expect(separation(A, moved)).toBeLessThan(1e-6)
        },
      ),
    )
  })
})

describe('growConvex', () => {
  it('contains every point within d of the polygon, and stays convex', () => {
    fc.assert(
      fc.property(convexPolygon, fc.double({ min: 0.001, max: 5, noNaN: true }), (P, d) => {
        const grown = growConvex(P, d)
        expect(isConvexCcw(grown)).toBe(true)
        // Points at distance d along each vertex's edge normals lie on or inside.
        P.forEach((p, k) => {
          const q = P[(k + 1) % P.length]!
          const len = Math.hypot(q[0] - p[0], q[1] - p[1])
          const n: Vec2 = [(q[1] - p[1]) / len, (p[0] - q[0]) / len]
          for (const v of [p, q]) {
            expect(insideDistance(grown, [v[0] + d * n[0], v[1] + d * n[1]])).toBeGreaterThan(-1e-9)
          }
        })
        // Every edge moved out by exactly d.
        for (const p of P) expect(insideDistance(grown, p)).toBeCloseTo(d, 9)
      }),
    )
  })

  it('tolerates collinear and duplicate vertices', () => {
    const sq: Vec2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]
    const g = growConvex(sq, 1)
    expect(Math.abs(ringArea(g))).toBeCloseTo(16, 9)
  })
})

describe('rectIfp', () => {
  const bin = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
  const tri: Vec2[] = [
    [-10, -5],
    [10, -5],
    [0, 15],
  ]

  it('keeps the part inside the bin, touching it at the corners of the range', () => {
    const ifp = rectIfp(bin, tri)!
    expect(ifp).toEqual({ minX: 10, minY: 5, maxX: 90, maxY: 35 })
    for (const T of [
      [ifp.minX, ifp.minY],
      [ifp.maxX, ifp.maxY],
    ] as Vec2[]) {
      for (const [x, y] of translate(tri, T)) {
        expect(x).toBeGreaterThanOrEqual(bin.minX)
        expect(x).toBeLessThanOrEqual(bin.maxX)
        expect(y).toBeGreaterThanOrEqual(bin.minY)
        expect(y).toBeLessThanOrEqual(bin.maxY)
      }
    }
  })

  it('accounts for rotation, and returns null when the part cannot fit', () => {
    const rotated = rectIfp(bin, tri, Math.PI)!
    expect(rotated.minY).toBeCloseTo(15, 12)
    expect(rotated.maxY).toBeCloseTo(45, 12)
    expect(rectIfp({ ...bin, maxY: 19 }, tri)).toBeNull()
    expect(rectIfp({ ...bin, maxY: 20 }, tri)).not.toBeNull() // exact fit
  })
})

describe('NfpCache', () => {
  const FINGER: JointOptions = { kind: 'finger', widthMm: 10, tip: 'fill', clearanceMm: 0.1 }
  const BIG: NestSettings = { ...DEFAULT_NEST_SETTINGS, sheetWidthMm: 2000, sheetHeightMm: 2000 }
  const prep = (shape: PresetId, joint?: JointOptions) => {
    const frames = buildFrames(preset(shape))
    const panels = panelShapes(frames, {
      mmPerUnit: 100 / longestEdge(frames),
      thicknessMm: 3,
      joint,
    })
    return prepareParts(panels, BIG)
  }

  it('matches the directly computed NFP at any pair of angles', () => {
    // Pentagons (5-fold) and hexagons (3-fold): mixed symmetry periods.
    const { shapes } = prep('truncated-icosahedron', FINGER)
    expect(shapes).toHaveLength(2)
    const cache = new NfpCache(shapes)
    const angle = fc.integer({ min: 0, max: 71 }).map((k) => (k * 5 * Math.PI) / 180)
    fc.assert(
      fc.property(fc.nat(1), fc.nat(1), angle, angle, (a, b, alpha, beta) => {
        const direct = convexNfp(
          shapes[a]!.polygon.map((p) => rot(p, alpha)),
          shapes[b]!.polygon.map((p) => rot(p, beta)),
        )
        expectSameRegion(cache.get(a, alpha, b, beta), direct)
      }),
      { numRuns: 200 },
    )
  })

  it('needs one NFP per relative angle modulo symmetry', () => {
    const { shapes, parts } = prep('icosahedron')
    const cache = new NfpCache(shapes)
    for (const pa of parts) {
      for (const pb of parts) {
        for (const a of pa.angles) for (const b of pb.angles) cache.get(0, a.alpha, 0, b.alpha)
      }
    }
    // Free mode, 15° steps on a 3-fold triangle: alphas 0–105°, relative angles mod 120°.
    expect(cache.size).toBe(8)
  })
})
