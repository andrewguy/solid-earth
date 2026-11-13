import type { Position } from 'geojson'

import { type Vec3, add, cross, normalize, scale } from '../vec3'
import { removeSeams } from './lines'
import { lonLatToVec3 } from './lonlat'

/**
 * The Moon as map data (plan §16). Longitude is selenographic, east positive, −180…180°
 * (IAU Moon 2000); latitude is selenographic. Panels seen from outside look as the Moon does from
 * Earth, so no mirroring is needed.
 */
export interface MoonData {
  /** The maria, merged into one region: d3-wound polygons, simplified to about 3 km. */
  readonly maria: readonly (readonly (readonly Position[])[])[]
  /** Flat [lon, lat, diameterKm] triples, largest first: IAU named and satellite craters ≥ 10 km. */
  readonly craters: readonly number[]
}

/** Mean lunar radius (IAU), km. */
export const MOON_RADIUS_KM = 1737.4

/** Crater rims are drawn with roughly this segment length, within 24–96 segments. */
const RIM_SEGMENT_KM = 10

/** Number of craters no smaller than `minDiameterKm` (they are sorted largest first). */
export function craterCount(craters: readonly number[], minDiameterKm: number): number {
  let n = 0
  while (n * 3 + 2 < craters.length && craters[n * 3 + 2]! >= minDiameterKm) n++
  return n
}

/**
 * The maria's outlines for stroking: their polygon rings as polylines. One small mare (near
 * 180°, 35–39° S) is split at the antimeridian in the source; the seam between its halves is
 * removed, as for Earth's coastlines, so Outline mode doesn't engrave it.
 */
export const mariaOutlines = (moon: MoonData): Position[][] =>
  removeSeams(moon.maria.flatMap((rings) => rings))

/**
 * Light direction for crater shadows: from the upper left of the local surface (north-west),
 * as on shaded-relief maps (plan §16.8). Every crater gets a shadow, the same way round
 * everywhere on the globe.
 */
const LIGHT_AZIMUTH_DEG = 315

/**
 * How far the shadow reaches across the crater, as a fraction of its radius: deep bowls
 * (≤ 50 km) are shaded across 40 %, falling with log diameter to 10 % for flat-floored basins
 * of 500 km and more.
 */
export function shadowFraction(diameterKm: number): number {
  const t = Math.log10(diameterKm / 50)
  return Math.min(0.4, Math.max(0.1, 0.4 - 0.3 * t))
}

/** Unit tangent vectors at `c`: local north and east (any orthonormal pair at the poles). */
function localFrame(c: Vec3): { north: Vec3; east: Vec3 } {
  const z: Vec3 = [0, 0, 1]
  const eastRaw = cross(z, c)
  const east: Vec3 = Math.hypot(...eastRaw) < 1e-9 ? [0, 1, 0] : normalize(eastRaw)
  return { north: cross(c, east), east }
}

/** How much each crater departs from a plain circle with a plain crescent (plan §16.8). */
const DEPTH_VARIATION = 0.3 // shadow depth × 0.7–1.3
const AZIMUTH_VARIATION_DEG = 12 // light direction ± 12°
const EDGE_VARIATION = 0.35 // ragged inner edge: up to ± 35 % of the shadow's depth
/**
 * Rim out-of-roundness: the largest amplitude of each harmonic of the rim's radius (2 = oval,
 * 3–5 = lumpy or polygonal), as a fraction of the radius, for craters of 100 km and more;
 * half that at 10 km. Kept small enough (Σ a·(k² − 1) < 1) that every rim stays convex, which
 * the shadow construction relies on.
 */
const RIM_HARMONICS: readonly (readonly [k: number, max: number])[] = [
  [2, 0.06],
  [3, 0.03],
  [4, 0.015],
  [5, 0.01],
]
/** Central peaks: on this share of complex craters in this size range (km). */
const PEAK_CHANCE = 0.55
const PEAK_MIN_KM = 45
const PEAK_MAX_KM = 180 // larger basins have peak rings or flooded floors instead

/** A central peak, in the crater's local (north, west) plane, in units of the crater's radius. */
export interface CentralPeak {
  readonly x: number
  readonly y: number
  readonly radius: number
  /** Shadow length, in peak radii, before the crater's depth factor. */
  readonly shadow: number
}

/**
 * One crater's departures from the plain circle and crescent: real craters differ in shape,
 * depth, rim height and wall slumping, and complex ones have central peaks. Seeded from the
 * crater's own position and size, so each crater always looks the same, whatever the crater
 * limit or globe orientation.
 */
export interface CraterVariation {
  /** Multiplies `shadowFraction`. */
  readonly depth: number
  /** Added to the light's azimuth, degrees. */
  readonly azimuthDeg: number
  /** Ragged inner edge: offset along the light, as a fraction of the shadow's depth, for t in 0…1 across the crescent. */
  readonly edge: (t: number) => number
  /** Rim radius as a multiple of the nominal radius, at angle φ from local north towards west. */
  readonly rim: (phi: number) => number
  /** Central peaks: none, one, or a pair. */
  readonly peaks: readonly CentralPeak[]
}

/** A small, fast seeded generator (mulberry32): uniform in [0, 1). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function craterVariation(lon: number, lat: number, diameterKm: number): CraterVariation {
  // The bundled values are rounded (0.01°, 0.1 km), so these integers are exact.
  let h = 2166136261
  for (const v of [Math.round(lon * 100), Math.round(lat * 100), Math.round(diameterKm * 10)]) {
    h = Math.imul(h ^ v, 16777619)
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  }
  const rand = seededRandom(h)
  const depth = 1 + DEPTH_VARIATION * (2 * rand() - 1)
  const azimuthDeg = AZIMUTH_VARIATION_DEG * (2 * rand() - 1)
  // A few low harmonics with random phases and weights: slumps and bulges, not noise.
  const waves = [2, 3, 5].map((k) => ({ k, phase: 2 * Math.PI * rand(), w: 0.4 + 0.6 * rand() }))
  const total = waves.reduce((sum, { w }) => sum + w, 0)
  const edge = (t: number) =>
    (EDGE_VARIATION / total) *
    waves.reduce((sum, { k, phase, w }) => sum + w * Math.sin(k * Math.PI * t + phase), 0)

  // Bigger craters are less round: half the out-of-roundness at 10 km, all of it from 100 km.
  const size = Math.min(1, Math.max(0.5, 0.5 + 0.5 * Math.log10(diameterKm / 10)))
  const lumps = RIM_HARMONICS.map(([k, max]) => ({
    k,
    a: size * max * rand(),
    phase: 2 * Math.PI * rand(),
  }))
  const rim = (phi: number) =>
    lumps.reduce((m, { k, a, phase }) => m + a * Math.cos(k * phi + phase), 1)

  // Draw the peaks' numbers whether or not the crater has any, to keep the sequence fixed.
  const p = Array.from({ length: 10 }, () => rand())
  const peaks: CentralPeak[] = []
  if (diameterKm >= PEAK_MIN_KM && diameterKm <= PEAK_MAX_KM && p[0]! < PEAK_CHANCE) {
    const off = 0.08 * p[1]!
    const at = 2 * Math.PI * p[2]!
    const radius = 0.07 + 0.06 * p[3]!
    const main = {
      x: off * Math.cos(at),
      y: off * Math.sin(at),
      radius,
      shadow: 2 + 1.5 * p[4]!,
    }
    peaks.push(main)
    if (p[5]! < 0.35) {
      // A smaller second peak alongside: many central peaks are clusters.
      const gap = radius * (1.2 + 0.8 * p[6]!)
      const dir = 2 * Math.PI * p[7]!
      peaks.push({
        x: main.x + gap * Math.cos(dir),
        y: main.y + gap * Math.sin(dir),
        radius: radius * (0.5 + 0.3 * p[8]!),
        shadow: 2 + 1.5 * p[9]!,
      })
    }
  }
  return { depth, azimuthDeg, edge, rim, peaks }
}

/** Segments in a rim of diameter `d` km. */
const rimSegments = (d: number) =>
  Math.min(96, Math.max(24, Math.round((Math.PI * d) / RIM_SEGMENT_KM)))

/**
 * A crater's rim in its gnomonic tangent plane, in (north, west) coordinates: `n` points at
 * equal angles from north, on the varied rim (`CraterVariation.rim`). Counter-clockwise seen
 * from outside. Rims and shadows both build on these points, so they line up exactly.
 */
function rimPlane(r: number, n: number, variation: CraterVariation): [number, number][] {
  return Array.from({ length: n }, (_, k) => {
    const phi = (2 * Math.PI * k) / n
    const rho = r * variation.rim(phi)
    return [rho * Math.cos(phi), rho * Math.sin(phi)]
  })
}

/** A crater's centre, its local frame (north, west: counter-clockwise from outside) and plane scale. */
function craterFrame(craters: readonly number[], i: number) {
  const lon = craters[i]!
  const lat = craters[i + 1]!
  const d = craters[i + 2]!
  const c = lonLatToVec3(lon, lat)
  const { north } = localFrame(c)
  const west = cross(c, north)
  return { lon, lat, d, c, north, west, r: Math.tan(d / 2 / MOON_RADIUS_KM) }
}

/**
 * Crater rims no smaller than `minDiameterKm`, as closed rings of unit vectors (plan §16.1):
 * true size on the sphere, so they scale with the globe, and each slightly out of round in
 * its own way (plan §16.8). Expects the craters largest first, as bundled. The largest crater
 * is about 9° in radius, so a rim's bounding cap stays small enough to cull without
 * splitting it into arcs.
 */
export function craterRims(craters: readonly number[], minDiameterKm: number): Vec3[][] {
  const out: Vec3[][] = []
  for (let i = 0; i + 2 < craters.length; i += 3) {
    if (craters[i + 2]! < minDiameterKm) break
    const { lon, lat, d, c, north, west, r } = craterFrame(craters, i)
    const plane = rimPlane(r, rimSegments(d), craterVariation(lon, lat, d))
    const ring = plane.map(([x, y]) => normalize(add(c, add(scale(north, x), scale(west, y)))))
    out.push([...ring, ring[0]!])
  }
  return out
}

/**
 * Crater shadows no smaller than `minDiameterKm` (plan §16.8): for each crater, the crescent
 * of its floor nearest the light, where the rim shades the inner wall, and the shadows of its
 * central peaks, if any. The crescent is the rim's shape minus the same shape moved away from
 * the light by `shadowFraction` of its radius, with each crater's own depth, light angle and
 * ragged inner edge (`craterVariation`).
 *
 * Built in the crater's gnomonic tangent plane and mapped back to the sphere. The crescent's
 * outer edge is the rim's own points, so it lines up with the Craters layer. Each polygon is
 * one open ring, wound the d3 way (clockwise seen from outside), ready for spherical clipping.
 */
export const craterShadows = (craters: readonly number[], minDiameterKm: number): Vec3[][][] =>
  craterShadowSets(craters, minDiameterKm).flat()

/** `craterShadows`, grouped by crater: its crescent first, then any peak shadows. */
export function craterShadowSets(craters: readonly number[], minDiameterKm: number): Vec3[][][][] {
  const out: Vec3[][][][] = []
  for (let i = 0; i + 2 < craters.length; i += 3) {
    if (craters[i + 2]! < minDiameterKm) break
    const { lon, lat, d, c, north, west, r } = craterFrame(craters, i)
    const variation = craterVariation(lon, lat, d)
    // The light's direction in the (north, west) plane; azimuth is clockwise from north.
    const az = ((LIGHT_AZIMUTH_DEG + variation.azimuthDeg) * Math.PI) / 180
    const [cu, su] = [Math.cos(-az), Math.sin(-az)]
    // Light frame: x towards the light, y 90° counter-clockwise from it.
    const toLight = ([x, y]: readonly [number, number]): [number, number] => [
      x * cu + y * su,
      -x * su + y * cu,
    ]
    const u = add(scale(north, cu), scale(west, su))
    const v = cross(c, u)
    const toSphere = (plane: [number, number][]) =>
      // Counter-clockwise in the plane is counter-clockwise from outside: reverse for d3.
      plane.map(([x, y]) => normalize(add(c, add(scale(u, x), scale(v, y))))).reverse()

    const s = Math.min(0.6, shadowFraction(d) * variation.depth) * r
    const rim = rimPlane(r, rimSegments(d), variation).map(toLight)
    const set: Vec3[][][] = [[toSphere(crescent(rim, s, variation.edge))]]
    for (const peak of variation.peaks) {
      const [px, py] = toLight([peak.x * r, peak.y * r])
      const pr = peak.radius * r
      // The shadow stretches away from the light, staying well inside the rim.
      const length = Math.min(pr * peak.shadow * variation.depth, px + 0.7 * r)
      set.push([toSphere(peakShadow(px, py, pr, Math.max(pr, length)))])
    }
    out.push(set)
  }
  return out
}

/**
 * The crescent of a convex rim (counter-clockwise, in light-frame coordinates: x towards the
 * light) that the rim shades: the rim's shape minus the same shape moved `s` away from the
 * light. At each height y the rim spans xm(y)…xp(y), and the shadow spans max(xm, xp − s)…xp:
 * the near wall's points, then back along the inner edge. The inner edge is moved along x by
 * `edge(t)` of `s` (t from 0 at the top to 1 at the bottom), fading out at the ends and kept
 * within 80 % of the room on either side, so it never crosses the rim or itself.
 */
function crescent(
  rim: readonly [number, number][],
  s: number,
  edge: (t: number) => number,
): [number, number][] {
  const n = rim.length
  let lo = 0
  let hi = 0
  rim.forEach(([, y], k) => {
    if (y < rim[lo]![1]) lo = k
    if (y > rim[hi]![1]) hi = k
  })
  // Near wall: counter-clockwise from the lowest point to the highest, through the light side.
  const near: [number, number][] = []
  for (let k = lo; ; k = (k + 1) % n) {
    near.push(rim[k]!)
    if (k === hi) break
  }
  const yTop = rim[hi]![1]
  const yBottom = rim[lo]![1]
  const out = [...near]
  // Far wall, walked from the top down alongside the near wall's points.
  let f = hi
  for (let j = near.length - 2; j >= 1; j--) {
    const [xp, y] = near[j]!
    while (rim[(f + 1) % n]![1] > y) f = (f + 1) % n
    const [ax, ay] = rim[f]!
    const [bx, by] = rim[(f + 1) % n]!
    const xm = ay === by ? Math.min(ax, bx) : ax + ((y - ay) / (by - ay)) * (bx - ax)
    const x = Math.max(xm, xp - s)
    const t = (yTop - y) / (yTop - yBottom)
    const offset = s * edge(t) * Math.sin(Math.PI * t)
    // Positive offset deepens the shadow (away from the light).
    out.push([Math.min(x + 0.8 * (xp - x), Math.max(x - 0.8 * (x - xm), x - offset)), y])
  }
  return out
}

/**
 * A central peak's shadow, in light-frame coordinates: an egg from just in front of the
 * peak's crest, `length` back away from the light, as wide as the peak. Counter-clockwise.
 */
function peakShadow(px: number, py: number, radius: number, length: number): [number, number][] {
  const n = 20
  return Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n
    const cos = Math.cos(a)
    return [px + cos * (cos >= 0 ? 0.35 * radius : length), py + radius * Math.sin(a)]
  })
}
