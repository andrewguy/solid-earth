import { type Quat, conjugate, fromAxisAngle, multiply, normalizeQuat, rotate } from '../quat'
import type { Vec3 } from '../vec3'
import { vec3ToLonLat } from './lonlat'

const RAD = Math.PI / 180
const Z: Vec3 = [0, 0, 1]

export interface RotationReadout {
  /** Geographic point at the top of the solid (world +z), degrees. */
  readonly lon: number
  readonly lat: number
  /** Spin about that point, degrees in (−180, 180]. */
  readonly roll: number
}

/** Rotation taking geographic point (lon, lat) to world +z with no roll. */
export function topRotation(lon: number, lat: number): Quat {
  // Rz(−lon) brings the point into the x–z plane; Ry(lat − 90°) then lifts it to +z.
  return multiply(fromAxisAngle([0, 1, 0], (lat - 90) * RAD), fromAxisAngle(Z, -lon * RAD))
}

/**
 * Human-readable form of the globe rotation `q` (map → world) for the read-only display
 * (plan §3): which geographic point sits at the top of the solid, and the roll about it.
 * Identity reads as lat 90° (north pole on top), lon 0°, roll 0°.
 */
export function rotationReadout(q: Quat): RotationReadout {
  const [lon, lat] = vec3ToLonLat(rotate(conjugate(q), Z))
  // q = Rz(roll) · topRotation(lon, lat); the remainder is a pure z rotation.
  const r = normalizeQuat(multiply(q, conjugate(topRotation(lon, lat))))
  let roll = (2 * Math.atan2(r[2], r[3])) / RAD
  if (roll > 180) roll -= 360
  if (roll <= -180) roll += 360
  return { lon, lat, roll }
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from: Vec3, to: Vec3): Quat {
  const c: Vec3 = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ]
  const w = 1 + from[0] * to[0] + from[1] * to[1] + from[2] * to[2]
  if (w < 1e-12) {
    // Opposite vectors: rotate π about any perpendicular axis.
    const axis: Vec3 = Math.abs(from[0]) < 0.9 ? [0, -from[2], from[1]] : [-from[2], 0, from[0]]
    return fromAxisAngle(axis, Math.PI)
  }
  return normalizeQuat([c[0], c[1], c[2], w])
}
