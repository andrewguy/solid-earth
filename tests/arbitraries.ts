import fc from 'fast-check'

import { type Quat, normalizeQuat } from '@/core/quat'
import { type Vec3, add, length, normalize, scale } from '@/core/vec3'

const coord = fc.double({ min: -1, max: 1, noNaN: true })

/** Uniform-ish random unit vector. */
export const unitVec3 = fc
  .tuple(coord, coord, coord)
  .filter((v) => length(v) > 1e-3)
  .map((v): Vec3 => normalize(v))

/** Random unit quaternion (rotation). */
export const rotation = fc
  .tuple(coord, coord, coord, coord)
  .filter((q) => Math.hypot(...q) > 1e-3)
  .map((q): Quat => normalizeQuat(q))

/**
 * Random polyline on the unit sphere with short steps (each segment well under 90°),
 * so segments are unambiguous great-circle arcs.
 */
export const sphericalPolyline = fc
  .tuple(unitVec3, fc.array(fc.tuple(coord, coord, coord), { minLength: 1, maxLength: 40 }))
  .map(([start, steps]) => {
    const pts: Vec3[] = [start]
    for (const step of steps) {
      const prev = pts[pts.length - 1]!
      const next = add(prev, scale(step, 0.6))
      if (length(next) > 1e-6) pts.push(normalize(next))
    }
    return pts
  })
  .filter((pts) => pts.length >= 2)

export const closeTo = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

export const vecCloseTo = (a: readonly number[], b: readonly number[], tol: number) =>
  a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= tol)
