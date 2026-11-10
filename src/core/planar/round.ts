import type { Vec2 } from '../vec3'

/** Default output precision in mm (plan §5: well under laser precision). */
export const PRECISION_MM = 0.01

/** Round to a grid of `precision`, avoiding binary artefacts like 1.2300000000000002. */
export function roundTo(x: number, precision = PRECISION_MM): number {
  const inv = 1 / precision
  const r = Math.round(x * inv) / inv
  return r === 0 ? 0 : r // no -0 in output
}

/** Round each point and drop consecutive duplicates. */
export function roundPolyline(points: readonly Vec2[], precision = PRECISION_MM): Vec2[] {
  const out: Vec2[] = []
  for (const [x, y] of points) {
    const p: Vec2 = [roundTo(x, precision), roundTo(y, precision)]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}
