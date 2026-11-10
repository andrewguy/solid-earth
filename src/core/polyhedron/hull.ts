import { type Vec3, cross, dot, length, normalize, scale, sub } from '../vec3'

/**
 * Faces of the convex hull of a small point set, by brute force over vertex triples.
 *
 * Intended for generating presets from their vertex sets (tens of points), not for user
 * input; custom polyhedra go through the full preprocessing pipeline (milestone 5).
 * Coplanar points are merged into a single polygonal face, ordered CCW as seen from outside.
 * Every point is assumed to be a hull vertex (true for the presets).
 */
export function convexHullFaces(points: readonly Vec3[]): number[][] {
  const n = points.length
  const extent = Math.max(...points.map(length))
  const tol = 1e-9 * extent
  const seen = new Set<string>()
  const faces: number[][] = []

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const pi = points[i]!
        const c = cross(sub(points[j]!, pi), sub(points[k]!, pi))
        if (length(c) < tol * extent) continue // collinear
        let normal = normalize(c)
        let d = dot(normal, pi)
        const side = points.map((p) => dot(normal, p) - d)
        if (side.every((s) => s <= tol)) {
          // normal already points outward
        } else if (side.every((s) => s >= -tol)) {
          normal = scale(normal, -1)
          d = -d
        } else {
          continue // plane cuts through the point set
        }
        const onPlane = side.flatMap((s, m) => (Math.abs(s) <= tol ? [m] : []))
        const key = onPlane.join(',')
        if (seen.has(key)) continue
        seen.add(key)
        faces.push(orderCcw(points, onPlane, normal))
      }
    }
  }
  return faces
}

/** Sort coplanar point indices CCW around their centroid, viewed from the side `normal` faces. */
function orderCcw(points: readonly Vec3[], indices: number[], normal: Vec3): number[] {
  const pts = indices.map((i) => points[i]!)
  const centroid = scale(
    pts.reduce<Vec3>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]),
    1 / pts.length,
  )
  const u = normalize(sub(pts[0]!, centroid))
  const w = cross(normal, u)
  const angleOf = (p: Vec3) => {
    const r = sub(p, centroid)
    return Math.atan2(dot(r, w), dot(r, u))
  }
  return indices
    .map((idx, m) => ({ idx, a: angleOf(pts[m]!) }))
    .sort((x, y) => x.a - y.a)
    .map((e) => e.idx)
}
