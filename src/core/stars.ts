import type { Paths64 } from 'clipper2-ts'

import { fromPaths64, ringArea, subtract, toPaths64, unionPositive } from './planar/clipper'
import type { Vec2 } from './vec3'

/** How stars are drawn and which are cut through (plan §15.2). Sizes in mm. */
export interface StarOptions {
  /** Faintest star shown (magnitude). */
  readonly magLimit: number
  /** Diameter of a star at the magnitude limit. */
  readonly minDiameterMm: number
  /** Diameter at magnitude 0 and brighter. */
  readonly maxDiameterMm: number
  /** Cut-out stars, or null when the Star holes layer is off (every star is engraved). */
  readonly holes: {
    /** Stars at or brighter than this are cut through. */
    readonly magLimit: number
    /** Smallest hole cut. */
    readonly minDiameterMm: number
  } | null
}

/**
 * Engraved star diameter: linear in magnitude, the max at magnitude 0 (and brighter), the min at
 * the limit (plan §15.2).
 */
export function starDiameterMm(mag: number, o: StarOptions): number {
  if (!(o.magLimit > 0)) return o.maxDiameterMm
  const t = Math.min(1, Math.max(0, mag / o.magLimit))
  return o.maxDiameterMm + t * (o.minDiameterMm - o.maxDiameterMm)
}

/** True if a star of this magnitude is cut as a hole. */
export const isHole = (mag: number, o: StarOptions) => o.holes !== null && mag <= o.holes.magLimit

/** Diameter a star is drawn or cut at: holes are never below the minimum hole size. */
export function starSizeMm(mag: number, o: StarOptions): number {
  const d = starDiameterMm(mag, o)
  return o.holes && isHole(mag, o) ? Math.max(d, o.holes.minDiameterMm) : d
}

/** Largest diameter any star can have with these options. */
export const largestStarMm = (o: StarOptions) =>
  Math.max(o.maxDiameterMm, o.minDiameterMm, o.holes?.minDiameterMm ?? 0)

/** Segment length target for star circles, in mm. */
const SEGMENT_MM = 0.25

/** A circle as a CCW ring (y up) of 12–72 points, depending on its size. */
export function circleRing([cx, cy]: Vec2, diameterMm: number): Vec2[] {
  const r = diameterMm / 2
  const n = Math.min(72, Math.max(12, Math.round((Math.PI * diameterMm) / SEGMENT_MM)))
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = (2 * Math.PI * i) / n
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

/** Star holes on one panel, sorted by how they meet its outline (plan §15.2). */
export interface PanelHoles {
  /** Holes wholly inside the panel: cut on the Star holes layer. */
  readonly inside: Vec2[][]
  /** The panel region with every hole that crosses its outline subtracted (the notches). */
  readonly panel: Paths64
  /** Every hole that touches the panel, merged where they overlap: nothing engraves here. */
  readonly all: Paths64
}

/**
 * Merge overlapping hole circles, then sort them: holes wholly inside `panel` stay holes, holes
 * that cross its outline are subtracted from it as notches, and holes entirely outside are
 * dropped. `panel` and the result are in Clipper units; `inside` is in mm, unrounded.
 */
export function sortHoles(circles: readonly Vec2[][], panel: Paths64): PanelHoles {
  if (circles.length === 0) return { inside: [], panel, all: [] }
  const merged = unionPositive(toPaths64(circles))
  const inside: Vec2[][] = []
  const crossing: Paths64 = []
  const all: Paths64 = []
  for (const ring of merged) {
    const mm = fromPaths64([ring], null)[0]
    // Clipper's union returns islands of a merged hole as clockwise rings; a ring of holes
    // closing on itself is not worth handling, so they are ignored.
    if (!mm || ringArea(mm) <= 0) continue
    const outside = subtract([ring], panel)
    const outsideArea = fromPaths64(outside, null).reduce((s, r) => s + Math.abs(ringArea(r)), 0)
    if (outsideArea === 0) {
      inside.push(mm)
      all.push(ring)
    } else if (outsideArea < ringArea(mm) * (1 - 1e-6)) {
      crossing.push(ring)
      all.push(ring)
    }
  }
  return { inside, panel: crossing.length > 0 ? subtract(panel, crossing) : panel, all }
}

/**
 * The largest counter-clockwise ring of `paths` in mm (unrounded), starting at the vertex nearest
 * `start` so output stays stable: the panel outline after notching.
 */
export function mainRing(paths: Paths64, [sx, sy]: Vec2): Vec2[] {
  const rings = fromPaths64(paths, null).filter((r) => ringArea(r) > 0)
  const ring = rings.reduce<Vec2[] | null>(
    (a, b) => (a && ringArea(a) >= ringArea(b) ? a : b),
    null,
  )
  if (!ring) throw new Error('star holes left no panel')
  let first = 0
  let best = Infinity
  ring.forEach(([x, y], i) => {
    const d = (x - sx) ** 2 + (y - sy) ** 2
    if (d < best) {
      best = d
      first = i
    }
  })
  return [...ring.slice(first), ...ring.slice(0, first)]
}
