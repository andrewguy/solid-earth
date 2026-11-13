import type { Position } from 'geojson'

import { type Vec3, add, cross, normalize, scale } from '../vec3'
import { lonLatToVec3 } from './lonlat'

/**
 * The night sky as map data (plan §15). Longitude is right ascension in degrees (0–24 h as
 * −180…180°), latitude is declination, epoch J2000. Unmirrored, panels seen from outside show a
 * traditional celestial globe: right ascension increases to the right with north up.
 */
export interface SkyData {
  /** Flat [lon, lat, magnitude] triples, brightest first. */
  readonly stars: readonly number[]
  /** Constellation stick figures: each segment is a great-circle arc between two stars. */
  readonly constellations: readonly (readonly Position[])[]
  /**
   * The Milky Way's outer band for filling, cut into small lon/lat tiles (d3 winding) so every
   * ring stays well within a hemisphere for spherical clipping.
   */
  readonly milkyWay: readonly (readonly (readonly Position[])[])[]
  /** The band's outline (its original rings), for stroking. */
  readonly milkyWayEdges: readonly (readonly Position[])[]
}

/** A star as a direction and a brightness. */
export interface PreparedStar {
  readonly dir: Vec3
  readonly mag: number
}

/** Obliquity of the ecliptic at J2000 (IAU 2006), in degrees. */
export const OBLIQUITY_DEG = 23.4392911

const RAD = Math.PI / 180

/**
 * Mirror the sky to the view from Earth (plan §15.1): longitude → −longitude. A reflection
 * reverses ring orientation, so rings are reversed to keep the d3 winding. Mirroring twice gives
 * back the original data.
 */
export function mirrorSky(sky: SkyData): SkyData {
  return {
    stars: sky.stars.map((v, i) => (i % 3 === 0 ? -v : v)),
    constellations: mirrorLines(sky.constellations),
    milkyWay: sky.milkyWay.map((rings) => rings.map((ring) => ring.map(flip).reverse())),
    milkyWayEdges: mirrorLines(sky.milkyWayEdges),
  }
}

const flip = (p: Position): Position => [-p[0]!, p[1]!]

/** Mirror polylines (longitude → −longitude), as `mirrorSky` does. */
export const mirrorLines = (lines: readonly (readonly Position[])[]): Position[][] =>
  lines.map((line) => line.map(flip))

/** Stars no fainter than `magLimit` (all of them by default), as directions. */
export function prepareStars(stars: readonly number[], magLimit = Infinity): PreparedStar[] {
  const out: PreparedStar[] = []
  for (let i = 0; i + 2 < stars.length; i += 3) {
    const mag = stars[i + 2]!
    if (mag <= magLimit) out.push({ dir: lonLatToVec3(stars[i]!, stars[i + 1]!), mag })
  }
  return out
}

/**
 * Constellation lines as unit vectors. Each segment is a great-circle arc, which gnomonic
 * projection maps to a straight line, so the vertices are used as they are: no densifying.
 */
export function prepareGreatCircleLines(lines: readonly (readonly Position[])[]): Vec3[][] {
  return lines.filter((l) => l.length >= 2).map((l) => l.map((p) => lonLatToVec3(p[0]!, p[1]!)))
}

/** Arcs per circle, so each arc's bounding cap is small enough for culling. */
const ARCS = 12
const STEP_DEG = 2

/**
 * A great circle as `ARCS` polylines in [lon, lat]: `point(t)` gives the position at angle t
 * (degrees) along it.
 */
function circleArcs(point: (tDeg: number) => Position): Position[][] {
  const per = 360 / ARCS
  return Array.from({ length: ARCS }, (_, k) =>
    Array.from({ length: per / STEP_DEG + 1 }, (_, i) => point(k * per + i * STEP_DEG)),
  )
}

/** The celestial equator and the ecliptic, as great-circle arcs in [lon, lat] (J2000). */
export function eclipticAndEquator(): Position[][] {
  const e = OBLIQUITY_DEG * RAD
  const equator = circleArcs((t) => [t > 180 ? t - 360 : t, 0])
  const ecliptic = circleArcs((t) => {
    // Ecliptic longitude λ = t → right ascension α and declination δ.
    const l = t * RAD
    const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD
    const dec = Math.asin(Math.sin(e) * Math.sin(l)) / RAD
    return [ra, dec]
  })
  return [...equator, ...ecliptic]
}

/**
 * Small circles on the sphere around each star no fainter than `magLimit`, `radiusRad(mag)` in
 * angular radius: markers for the live preview while dragging, where the 2D star dots aren't
 * drawn.
 */
export function starMarkers(
  stars: readonly PreparedStar[],
  magLimit: number,
  radiusRad: (mag: number) => number,
  segments = 8,
): Vec3[][] {
  const out: Vec3[][] = []
  for (const { dir, mag } of stars) {
    if (mag > magLimit) continue
    const axis: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const e1 = normalize(cross(dir, axis))
    const e2 = cross(dir, e1)
    const k = Math.tan(radiusRad(mag))
    out.push(
      Array.from({ length: segments + 1 }, (_, i) => {
        const a = (2 * Math.PI * i) / segments
        return normalize(add(dir, add(scale(e1, k * Math.cos(a)), scale(e2, k * Math.sin(a)))))
      }),
    )
  }
  return out
}
