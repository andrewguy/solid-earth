import { type Quat, conjugate, fromAxisAngle, multiply, normalizeQuat, rotate } from '../quat'
import { type Vec3, normalize } from '../vec3'
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

/** Direct formula; well conditioned only while the angle is clearly below 180°. */
function rotationBetweenNear(from: Vec3, to: Vec3): Quat {
  const c: Vec3 = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ]
  return normalizeQuat([c[0], c[1], c[2], 1 + from[0] * to[0] + from[1] * to[1] + from[2] * to[2]])
}

/**
 * Shortest rotation taking unit vector `from` onto unit vector `to`.
 *
 * The direct formula loses all precision as the vectors approach opposite (1 + a·b cancels),
 * so past 120° this goes via a vector perpendicular to `from` and composes two ~90° rotations.
 * Each step maps its own inputs exactly, so the result is accurate however rough the midpoint.
 */
export function rotationBetween(from: Vec3, to: Vec3): Quat {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2]
  if (d > -0.5) return rotationBetweenNear(from, to)
  let m: Vec3 = [to[0] - d * from[0], to[1] - d * from[1], to[2] - d * from[2]]
  if (Math.hypot(...m) < 1e-6) {
    // Exactly opposite: any perpendicular will do.
    m = Math.abs(from[0]) < 0.9 ? [0, -from[2], from[1]] : [-from[2], 0, from[0]]
  }
  const mid = normalize(m)
  return multiply(rotationBetweenNear(mid, to), rotationBetweenNear(from, mid))
}
