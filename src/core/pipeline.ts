import { type Cap, boundingCap, capsOverlap, faceCap } from './clip/cull'
import { clipPolylineToCone } from './clip/polyline'
import type { LineLayerId } from './layers'
import { roundPolyline } from './planar/round'
import type { FaceFrame, PolyhedronFrames } from './polyhedron/faces'
import { gnomonic } from './project/gnomonic'
import { IDENTITY, type Quat, rotate } from './quat'
import { type Vec2, type Vec3, distance } from './vec3'

/** A unit-vector polyline with its bounding cap, for culling. */
export interface PreparedLine {
  readonly points: readonly Vec3[]
  readonly cap: Cap
}

/** Map data prepared once per dataset (plan §4.2): unit-vector linework per layer. */
export interface PreparedMap {
  readonly lines: Partial<Record<LineLayerId, readonly PreparedLine[]>>
}

/** Wrap unit-vector linework (e.g. from `prepareLines`) with bounding caps. */
export function prepareMap(lines: Partial<Record<LineLayerId, readonly Vec3[][]>>): PreparedMap {
  const out: Partial<Record<LineLayerId, PreparedLine[]>> = {}
  for (const [id, ls] of Object.entries(lines) as [LineLayerId, Vec3[][]][]) {
    out[id] = ls.map((points) => ({ points, cap: boundingCap(points) }))
  }
  return { lines: out }
}

export interface LayerArtwork {
  readonly polylines: readonly Vec2[][]
}

/**
 * One face's output in mm, in the face's own (u, v) frame: y up, origin at the face foot
 * point. Independent of the UI and of SVG (plan §4.4).
 */
export interface FaceArtwork {
  readonly faceIndex: number
  /** Face polygon, CCW. */
  readonly outline: readonly Vec2[]
  readonly layers: Partial<Record<LineLayerId, LayerArtwork>>
}

export interface ArtworkOptions {
  /** Model units → mm. */
  readonly mmPerUnit: number
  /** Output grid in mm; null to skip rounding (tests). */
  readonly precisionMm: number | null
}

/** Longest edge of the solid in model units (plan §3: longest edge = N mm). */
export function longestEdge(frames: PolyhedronFrames): number {
  const v = frames.def.vertices
  return Math.max(...frames.edges.map((e) => distance(v[e.a]!, v[e.b]!)))
}

/** Apply the globe rotation to all prepared vectors (plan §4.3). */
export function rotateMap(map: PreparedMap, q: Quat): PreparedMap {
  if (q.every((c, i) => c === IDENTITY[i])) return map
  const lines: Partial<Record<LineLayerId, PreparedLine[]>> = {}
  for (const [id, ls] of Object.entries(map.lines) as [LineLayerId, PreparedLine[]][]) {
    lines[id] = ls.map(({ points, cap }) => ({
      points: points.map((p) => rotate(q, p)),
      cap: { centre: rotate(q, cap.centre), radius: cap.radius },
    }))
  }
  return { lines }
}

function projectRun(face: FaceFrame, run: readonly Vec3[], mmPerUnit: number): Vec2[] {
  return run.map((p) => {
    const xy = gnomonic(face, p)
    // Clipped points are inside the face cone, so always in front of the plane.
    if (!xy) throw new Error(`face ${face.index}: clipped point behind the face plane`)
    return [xy[0] * mmPerUnit, xy[1] * mmPerUnit]
  })
}

/** Clip, project, scale and round one face's artwork (plan §4.4). `map` is already rotated. */
export function buildFaceArtwork(
  frames: PolyhedronFrames,
  faceIndex: number,
  map: PreparedMap,
  { mmPerUnit, precisionMm }: ArtworkOptions,
): FaceArtwork {
  const face = frames.faces[faceIndex]
  if (!face) throw new Error(`no face ${faceIndex}`)
  const finish = (pts: Vec2[]) => (precisionMm === null ? pts : roundPolyline(pts, precisionMm))

  const cap = faceCap(face)
  const layers: Partial<Record<LineLayerId, LayerArtwork>> = {}
  for (const [id, lines] of Object.entries(map.lines) as [LineLayerId, PreparedLine[]][]) {
    const polylines: Vec2[][] = []
    for (const line of lines) {
      if (!capsOverlap(cap, line.cap)) continue
      for (const run of clipPolylineToCone(line.points, face.edgePlanes)) {
        const pts = finish(projectRun(face, run, mmPerUnit))
        if (pts.length >= 2) polylines.push(pts)
      }
    }
    layers[id] = { polylines }
  }

  const outline = finish(face.vertices2D.map(([x, y]): Vec2 => [x * mmPerUnit, y * mmPerUnit]))
  return { faceIndex, outline, layers }
}

/** Artwork for every face. */
export function buildAllFaces(
  frames: PolyhedronFrames,
  map: PreparedMap,
  options: ArtworkOptions,
): FaceArtwork[] {
  return frames.faces.map((_, i) => buildFaceArtwork(frames, i, map, options))
}
