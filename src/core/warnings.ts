import type { PolyhedronFrames } from './polyhedron/faces'
import { length } from './vec3'

export type DistortionLevel = 'low' | 'moderate' | 'severe'

export interface Distortion {
  /** Largest corner-to-centre areal scale of the gnomonic projection over all faces. */
  readonly areal: number
  /** The same for lengths along a ray from the centre (radial linear scale). */
  readonly radial: number
  readonly level: DistortionLevel
}

/**
 * Gnomonic distortion per shape (plan §5, §6.6). For a face plane at distance d, a point at
 * distance r from the origin has areal scale (r/d)³ and radial scale (r/d)² relative to the
 * face centre, so the worst case is at the farthest vertex. Icosahedron ≈ 2×, cube ≈ 5.2×,
 * tetrahedron 27× (areal).
 */
export function distortion(frames: PolyhedronFrames): Distortion {
  let worst = 1
  for (const f of frames.faces) {
    for (const v of f.vertices) worst = Math.max(worst, length(v) / f.distance)
  }
  const areal = worst ** 3
  return {
    areal,
    radial: worst ** 2,
    level: areal <= 2.5 ? 'low' : areal <= 6 ? 'moderate' : 'severe',
  }
}

/** Total export size above which LightBurn and browsers start to struggle. */
export const LARGE_OUTPUT_BYTES = 4 * 1024 * 1024
