import type { Vec3 } from '../vec3'

const RAD = Math.PI / 180

/**
 * Longitude/latitude in degrees → unit vector.
 * Axes: +x = (0°E, 0°N), +y = (90°E, 0°N), +z = north pole.
 */
export function lonLatToVec3(lon: number, lat: number): Vec3 {
  const λ = lon * RAD
  const φ = lat * RAD
  const c = Math.cos(φ)
  return [c * Math.cos(λ), c * Math.sin(λ), Math.sin(φ)]
}

/** Unit (or any non-zero) vector → [lon, lat] in degrees, lon in (−180, 180]. */
export function vec3ToLonLat(v: Vec3): [number, number] {
  const [x, y, z] = v
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]
}
