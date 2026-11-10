/** Minimal immutable 3D/2D vector helpers. Plain tuples: worker-transferable and easy to test. */

export type Vec3 = readonly [number, number, number]
export type Vec2 = readonly [number, number]

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]

export const negate = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]]

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b))

/** Unit vector in the direction of `a`. Throws on a zero vector rather than returning NaNs. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a)
  if (len === 0) throw new Error('normalize: zero-length vector')
  return [a[0] / len, a[1] / len, a[2] / len]
}

/** Linear interpolation a + t(b − a). */
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + t * (b[0] - a[0]),
  a[1] + t * (b[1] - a[1]),
  a[2] + t * (b[2] - a[2]),
]

/** Angle between two vectors in radians, numerically stable for small and near-π angles. */
export const angle = (a: Vec3, b: Vec3): number => Math.atan2(length(cross(a, b)), dot(a, b))
