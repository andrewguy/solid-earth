import type { Vec2 } from '../vec3'

/** Rigid 2D rotation by `rad` about the origin. */
export const rot = ([x, y]: Vec2, rad: number): Vec2 => {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [c * x - s * y, s * x + c * y]
}

/** Angle in [0, period). */
export const wrapAngle = (rad: number, period = 2 * Math.PI) => {
  const r = rad % period
  return r < 0 ? r + period : r
}

const cross3 = (o: Vec2, a: Vec2, b: Vec2) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/**
 * Convex hull of a point set (Andrew's monotone chain), CCW, y up. Vertices closer than `tol` to
 * the chord between their neighbours are dropped, so near-collinear noise can't make congruent
 * panels end up with different vertex counts. Dropping one moves the hull inward by < `tol`;
 * callers that need containment add `tol` to any later outward offset.
 */
export function convexHull(points: readonly Vec2[], tol: number): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) throw new Error('convex hull needs at least 3 points')
  const half = (list: readonly Vec2[]) => {
    const out: Vec2[] = []
    for (const p of list) {
      while (out.length >= 2 && cross3(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) {
        out.pop()
      }
      out.push(p)
    }
    out.pop()
    return out
  }
  let hull = [...half(pts), ...half([...pts].reverse())]
  // Drop near-collinear vertices until none is left (each removal can expose another).
  for (let changed = true; changed && hull.length > 3;) {
    changed = false
    for (let i = 0; i < hull.length && hull.length > 3; i++) {
      const n = hull.length
      const prev = hull[(i + n - 1) % n]!
      const next = hull[(i + 1) % n]!
      const chord = Math.hypot(next[0] - prev[0], next[1] - prev[1])
      // On a CCW hull every vertex lies right of its neighbours' chord; this is its distance.
      if (-cross3(prev, next, hull[i]!) / chord < tol) {
        hull = hull.filter((_, j) => j !== i)
        changed = true
        i--
      }
    }
  }
  if (hull.length < 3) throw new Error('convex hull is degenerate')
  return hull
}

/** Edge lengths of a polygon: edge k runs from vertex k to k+1. */
function signature(poly: readonly Vec2[]) {
  const n = poly.length
  return {
    lengths: poly.map((p, k) => {
      const q = poly[(k + 1) % n]!
      return Math.hypot(q[0] - p[0], q[1] - p[1])
    }),
  }
}

export interface Congruence {
  /** `b` ≈ R(rotation) · `a` + translation, every vertex within `tol`. */
  readonly rotation: number
  readonly translation: Vec2
}

/**
 * Every rigid motion (rotation + translation, never a reflection) taking convex CCW polygon `a`
 * onto `b` with every vertex within `tol`, one per matching cyclic shift; empty if they aren't
 * congruent. Matching `a` against itself gives its rotational symmetries.
 *
 * Edge lengths screen the shifts cheaply; each candidate is then fitted by least squares over all
 * vertices (2D Kabsch), which is robust to noise on short edges, and checked vertex by vertex.
 */
export function congruences(a: readonly Vec2[], b: readonly Vec2[], tol: number): Congruence[] {
  const n = a.length
  if (b.length !== n) return []
  const la = signature(a).lengths
  const lb = signature(b).lengths
  const mean = (p: readonly Vec2[]): Vec2 => [
    p.reduce((s, q) => s + q[0], 0) / n,
    p.reduce((s, q) => s + q[1], 0) / n,
  ]
  const [cax, cay] = mean(a)
  const [cbx, cby] = mean(b)
  const out: Congruence[] = []
  for (let s = 0; s < n; s++) {
    if (!la.every((l, k) => Math.abs(l - lb[(k + s) % n]!) <= 2 * tol)) continue
    let sc = 0
    let sd = 0
    for (let k = 0; k < n; k++) {
      const [ax, ay] = [a[k]![0] - cax, a[k]![1] - cay]
      const [bx, by] = [b[(k + s) % n]![0] - cbx, b[(k + s) % n]![1] - cby]
      sd += ax * bx + ay * by
      sc += ax * by - ay * bx
    }
    const rotation = wrapAngle(Math.atan2(sc, sd))
    const [rx, ry] = rot([cax, cay], rotation)
    const translation: Vec2 = [cbx - rx, cby - ry]
    const ok = a.every((p, k) => {
      const [x, y] = rot(p, rotation)
      const q = b[(k + s) % n]!
      return Math.hypot(x + translation[0] - q[0], y + translation[1] - q[1]) <= tol
    })
    if (ok) out.push({ rotation, translation })
  }
  return out
}

/** Axis-aligned bounds of a polygon rotated by `rad`. */
export function rotatedBounds(poly: readonly Vec2[], rad: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    const [x, y] = rot(p, rad)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}
