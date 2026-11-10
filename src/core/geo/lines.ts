import type { Position } from 'geojson'

import type { Vec3 } from '../vec3'
import { lonLatToVec3 } from './lonlat'

/** A polyline in [lon, lat] degrees. */
export type LonLatLine = readonly Position[]

const SEAM_TOL = 1e-9
const POLE_LAT = -89.99

const onAntimeridian = (p: Position) => Math.abs(Math.abs(p[0]!) - 180) <= SEAM_TOL

/**
 * True if the segment a→b is an artefact of cutting polygons for planar lon/lat storage rather
 * than a real feature (plan §5): it runs along the ±180° meridian (both ends on the same side),
 * or along the degenerate south-pole edge of Antarctica.
 */
export function isSeamSegment(a: Position, b: Position): boolean {
  if (onAntimeridian(a) && onAntimeridian(b) && Math.sign(a[0]!) === Math.sign(b[0]!)) return true
  return a[1]! <= POLE_LAT && b[1]! <= POLE_LAT
}

/** Remove seam segments, splitting lines where they occur. Drops pieces shorter than 2 points. */
export function removeSeams(lines: readonly LonLatLine[]): Position[][] {
  const out: Position[][] = []
  for (const line of lines) {
    let current: Position[] = []
    line.forEach((p, i) => {
      if (i > 0 && isSeamSegment(line[i - 1]!, p)) {
        if (current.length >= 2) out.push(current)
        current = []
      }
      current.push(p)
    })
    if (current.length >= 2) out.push(current)
  }
  return out
}

/**
 * Densify in lon/lat by linear interpolation so no step exceeds `maxStepDeg` in longitude or
 * latitude (plan §4.2). Natural Earth is authored as planar lon/lat, so this keeps lines along
 * parallels (e.g. 49°N) the right shape after the great-circle-based projection. Segments that
 * cross the antimeridian interpolate the short way round. Original points are kept exactly.
 */
export function densifyLonLat(line: LonLatLine, maxStepDeg = 0.5): Position[] {
  if (line.length === 0) return []
  const out: Position[] = [line[0]!]
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    let dLon = b[0]! - a[0]!
    if (dLon > 180) dLon -= 360
    else if (dLon < -180) dLon += 360
    const dLat = b[1]! - a[1]!
    const steps = Math.ceil(Math.max(Math.abs(dLon), Math.abs(dLat)) / maxStepDeg)
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      out.push([a[0]! + t * dLon, a[1]! + t * dLat])
    }
    out.push(b)
  }
  return out
}

/**
 * Linework ready for projection: seams removed, densified, converted to unit vectors.
 * Pass `keepSeams` for generated lines that legitimately run along ±180° (the graticule).
 */
export function prepareLines(
  lines: readonly LonLatLine[],
  maxStepDeg = 0.5,
  { keepSeams = false } = {},
): Vec3[][] {
  return (keepSeams ? lines : removeSeams(lines)).map((line) =>
    densifyLonLat(line, maxStepDeg).map((p) => lonLatToVec3(p[0]!, p[1]!)),
  )
}

/** A polygon (exterior + holes) as open rings of unit vectors, d3 winding preserved. */
export type SphereRings = Vec3[][]

/**
 * Polygons ready for spherical clipping: rings densified and converted to unit vectors, with
 * the closing point dropped. Winding is kept as given (d3 / world-atlas convention: exterior
 * clockwise seen from outside, holes counter-clockwise; plan §4.2).
 */
export function preparePolygons(
  polygons: readonly (readonly LonLatLine[])[],
  maxStepDeg = 0.5,
): SphereRings[] {
  return polygons.map((rings) =>
    rings
      .map((ring) => {
        const pts = densifyLonLat(ring, maxStepDeg).map((p) => lonLatToVec3(p[0]!, p[1]!))
        const first = pts[0]
        const last = pts[pts.length - 1]
        if (first && last && pts.length > 1 && first.every((c, i) => c === last[i])) pts.pop()
        return pts
      })
      .filter((r) => r.length >= 3),
  )
}
