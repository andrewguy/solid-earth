import { type Vec3, cross, normalize } from './vec3'

/** Unit quaternion [x, y, z, w] representing a rotation. */
export type Quat = readonly [number, number, number, number]

export const IDENTITY: Quat = [0, 0, 0, 1]

/** Rotation of `radians` about `axis` (right-hand rule). */
export function fromAxisAngle(axis: Vec3, radians: number): Quat {
  const [x, y, z] = normalize(axis)
  const s = Math.sin(radians / 2)
  return [x * s, y * s, z * s, Math.cos(radians / 2)]
}

/** Hamilton product: rotating by `multiply(a, b)` applies `b` first, then `a`. */
export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]

export function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3])
  if (len === 0) throw new Error('normalizeQuat: zero quaternion')
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len]
}

/** Rotate vector `v` by unit quaternion `q` (v' = q v q*). */
export function rotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 (q.xyz × v);  v' = v + w t + q.xyz × t
  const u: Vec3 = [q[0], q[1], q[2]]
  const w = q[3]
  const t = cross(u, v)
  const tx = 2 * t[0]
  const ty = 2 * t[1]
  const tz = 2 * t[2]
  const c = cross(u, [tx, ty, tz])
  return [v[0] + w * tx + c[0], v[1] + w * ty + c[1], v[2] + w * tz + c[2]]
}
