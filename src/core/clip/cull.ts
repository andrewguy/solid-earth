import type { FaceFrame } from '../polyhedron/faces'
import { type Vec3, angle, length } from '../vec3'

/**
 * Spherical cap: all directions within `radius` radians of unit vector `centre`.
 * A radius of π means "everything" (no culling possible).
 */
export interface Cap {
  readonly centre: Vec3
  readonly radius: number
}

const EVERYTHING: Cap = { centre: [0, 0, 1], radius: Math.PI }

/**
 * Bounding cap of a polyline on the unit sphere (plan §4.4 step 1). Caps smaller than a
 * hemisphere are spherically convex, so they also contain the great-circle arcs between the
 * points; larger ones fall back to "everything".
 */
export function boundingCap(points: readonly Vec3[]): Cap {
  let sx = 0
  let sy = 0
  let sz = 0
  for (const p of points) {
    sx += p[0]
    sy += p[1]
    sz += p[2]
  }
  const len = length([sx, sy, sz])
  if (len < 1e-9) return EVERYTHING
  const centre: Vec3 = [sx / len, sy / len, sz / len]
  let radius = 0
  for (const p of points) radius = Math.max(radius, angle(centre, p))
  return radius < Math.PI / 2 ? { centre, radius } : EVERYTHING
}

/** Bounding cap of a face's cone (around its normal, through its farthest vertex). */
export function faceCap(face: FaceFrame): Cap {
  const radius = Math.max(...face.vertices.map((v) => angle(face.normal, v)))
  return radius < Math.PI / 2 ? { centre: face.normal, radius } : EVERYTHING
}

/** Conservative overlap test: false only if the caps certainly do not intersect. */
export function capsOverlap(a: Cap, b: Cap): boolean {
  if (a.radius >= Math.PI || b.radius >= Math.PI) return true
  return angle(a.centre, b.centre) <= a.radius + b.radius + 1e-9
}
