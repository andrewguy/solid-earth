import type { Vec2 } from '../vec3'

import { rot, rotatedBounds, wrapAngle } from './convex'
import type { Bin, NestShape } from './parts'

/**
 * No-fit and inner-fit polygons for convex parts (plan §13.3 NFP, §13.4 step 4).
 *
 * Convention: a part is placed by translating its (rotated) polygon so its origin lands at T.
 * NFP(A, B) is the set of T where B overlaps a fixed A: B touches A on its boundary, overlaps it
 * strictly inside, and is clear of it outside.
 */

const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]

/** Index of the lowest vertex (min y, then min x). */
function lowest(poly: readonly Vec2[]): number {
  let best = 0
  poly.forEach(([x, y], i) => {
    const [bx, by] = poly[best]!
    if (y < by || (y === by && x < bx)) best = i
  })
  return best
}

/**
 * Minkowski sum P ⊕ Q of two convex CCW polygons, by merging their edges in angle order, starting
 * from both lowest vertices. O(n + m); the result is convex and CCW. Parallel edges are merged.
 */
export function minkowskiConvex(P: readonly Vec2[], Q: readonly Vec2[]): Vec2[] {
  const n = P.length
  const m = Q.length
  const ip = lowest(P)
  const iq = lowest(Q)
  const p = (k: number) => P[(ip + k) % n]!
  const q = (k: number) => Q[(iq + k) % m]!
  const out: Vec2[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    const a = p(i)
    const b = q(j)
    out.push([a[0] + b[0], a[1] + b[1]])
    const ea: Vec2 = [p(i + 1)[0] - a[0], p(i + 1)[1] - a[1]]
    const eb: Vec2 = [q(j + 1)[0] - b[0], q(j + 1)[1] - b[1]]
    // Past the end of one polygon, only the other's edges remain.
    const c = i >= n ? -1 : j >= m ? 1 : cross(ea, eb)
    if (c >= 0) i++
    if (c <= 0) j++
  }
  return out
}

/** NFP of B around a fixed A, both convex CCW: A ⊕ (−B). Point reflection keeps −B CCW. */
export function convexNfp(A: readonly Vec2[], B: readonly Vec2[]): Vec2[] {
  return minkowskiConvex(
    A,
    B.map(([x, y]): Vec2 => [-x, -y]),
  )
}

/**
 * Inner-fit rectangle: the translations T that keep polygon B (already rotated) inside the bin,
 * or null if it can't fit. A degenerate (zero-width) range counts as a fit.
 */
export function rectIfp(bin: Bin, B: readonly Vec2[], rotation = 0): Bin | null {
  const b = rotatedBounds(B, rotation)
  const ifp = {
    minX: bin.minX - b.minX,
    minY: bin.minY - b.minY,
    maxX: bin.maxX - b.maxX,
    maxY: bin.maxY - b.maxY,
  }
  return ifp.minX <= ifp.maxX && ifp.minY <= ifp.maxY ? ifp : null
}

/**
 * Grow a convex CCW polygon outward by `d` with mitred corners: each vertex moves to where its two
 * edges' offset lines meet. The result contains every point within `d` of the polygon. Unlike
 * `insetPolygon` it accepts the near-collinear vertices a Minkowski sum can produce; vertices
 * closer together than 1e-9 are merged first.
 */
export function growConvex(poly: readonly Vec2[], d: number): Vec2[] {
  const pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]!
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9
  })
  const n = pts.length
  const normals = pts.map((p, k): Vec2 => {
    const q = pts[(k + 1) % n]!
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    return [(q[1] - p[1]) / len, (p[0] - q[0]) / len] // outward for CCW
  })
  return pts.map(([x, y], i) => {
    const a = normals[(i + n - 1) % n]!
    const b = normals[i]!
    // Convex corners turn by less than 180°, so 1 + a·b > 0.
    const f = d / (1 + a[0] * b[0] + a[1] * b[1])
    return [x + f * (a[0] + b[0]), y + f * (a[1] + b[1])]
  })
}

/** Angles are keyed to 1 / ANGLE_KEY radians. */
const ANGLE_KEY = 1e9

/** An angle in [0, period) that is within rounding of the period wraps to 0. */
const snap = (rad: number, symmetry: number) =>
  (2 * Math.PI) / symmetry - rad < 1 / ANGLE_KEY ? 0 : rad

/**
 * NFPs between nest shapes at given angles, cached by relative angle (plan §13.3 NFP cache):
 * NFP(R(α)·A, R(β)·B) = R(α) · NFP(A, R(β − α)·B). Shapes are centred, so B's own symmetry
 * reduces β − α modulo 2π / symmetry, and A's reduces α the same way.
 */
export class NfpCache {
  private readonly cache = new Map<string, Vec2[]>()

  private readonly shapes: readonly NestShape[]
  private readonly growMm: number

  /** `growMm` > 0 returns every NFP grown outward by that much (mitred, see `growConvex`). */
  constructor(shapes: readonly NestShape[], growMm = 0) {
    this.shapes = shapes
    this.growMm = growMm
  }

  /** Number of distinct NFPs computed so far. */
  get size(): number {
    return this.cache.size
  }

  /** NFP of shape `b` at angle `beta` around shape `a` at angle `alpha`, with A's origin at 0. */
  get(a: number, alpha: number, b: number, beta: number): Vec2[] {
    const A = this.shapes[a]!
    const B = this.shapes[b]!
    // R(α)·A = R(spin)·A as a set; the relative angle must then be taken from spin, not α.
    const spin = snap(wrapAngle(alpha, (2 * Math.PI) / A.symmetry), A.symmetry)
    const rel = snap(wrapAngle(beta - spin, (2 * Math.PI) / B.symmetry), B.symmetry)
    const key = `${a}:${b}:${Math.round(rel * ANGLE_KEY)}`
    let base = this.cache.get(key)
    if (!base) {
      base = convexNfp(
        A.polygon,
        B.polygon.map((p) => rot(p, rel)),
      )
      if (this.growMm > 0) base = growConvex(base, this.growMm)
      this.cache.set(key, base)
    }
    return spin === 0 ? base : base.map((p) => rot(p, spin))
  }
}
