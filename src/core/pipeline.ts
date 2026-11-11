import { type Cap, boundingCap, capsOverlap, faceCap } from './clip/cull'
import { clipRingToCone } from './clip/polygon'
import { clipPolylineToCone } from './clip/polyline'
import type { SphereRings } from './geo/lines'
import type { FillLayerId, LineSourceId } from './layers'
import { panelOutline, polygonConePlanes } from './panel'
import { fromPaths64, offsetPolygon, subtract, toPaths64, unionPositive } from './planar/clipper'
import { roundPolyline } from './planar/round'
import type { FaceFrame, PolyhedronFrames } from './polyhedron/faces'
import { gnomonic } from './project/gnomonic'
import { northUpRotation } from './project/orientation'
import { IDENTITY, type Quat, rotate } from './quat'
import { type Vec2, type Vec3, distance } from './vec3'

/** A unit-vector polyline with its bounding cap, for culling. */
export interface PreparedLine {
  readonly points: readonly Vec3[]
  readonly cap: Cap
}

/** A polygon (open rings of unit vectors, d3 winding) with its bounding cap. */
export interface PreparedPolygon {
  readonly rings: readonly (readonly Vec3[])[]
  readonly cap: Cap
}

/** Source polygons; ocean is derived per face (plan §4.2). */
export type PolygonSourceId = 'land' | 'lakes'

/** Map data prepared once per dataset (plan §4.2). */
export interface PreparedMap {
  readonly lines: Partial<Record<LineSourceId, readonly PreparedLine[]>>
  readonly polygons: Partial<Record<PolygonSourceId, readonly PreparedPolygon[]>>
}

/**
 * One face's output in mm, in the face's own (u, v) frame: y up, origin at the face foot
 * point. Independent of the UI and of SVG (plan §4.4).
 */
export interface FaceArtwork {
  readonly faceIndex: number
  /**
   * Rotation applied to the face frame for export (radians, CCW, y up): output = R · frame.
   * 0 unless north-up orientation was requested.
   */
  readonly rotation: number
  /**
   * The panel's outer surface, CCW: the true face, with each edge inset for square-cut butt
   * joints when a thickness is given (plan §3). Engraving is clipped to it.
   */
  readonly outline: readonly Vec2[]
  /** Path to cut: the outline offset outward by kerf/2, or the outline itself (plan §3 Kerf). */
  readonly cutOutline: readonly Vec2[]
  /** Projected linework per source. */
  readonly lines: Partial<Record<LineSourceId, readonly Vec2[][]>>
  /** Fill regions per layer: CCW exteriors, CW holes (render with even-odd or non-zero). */
  readonly fills: Partial<Record<FillLayerId, readonly Vec2[][]>>
}

export interface ArtworkOptions {
  /** Model units → mm. */
  readonly mmPerUnit: number
  /** Output grid in mm; null to skip rounding (tests, live previews). */
  readonly precisionMm: number | null
  /** Which fills to compute (they cost far more than linework). Default: none. */
  readonly fills?: Readonly<Partial<Record<FillLayerId, boolean>>>
  /**
   * Geographic north in world space (globe rotation applied to +z). When given, each panel is
   * rotated north-up (plan §3); otherwise output stays in the face's own frame.
   */
  readonly north?: Vec3
  /** Laser kerf in mm; the cut path is offset outward by half of it. 0 / absent = off. */
  readonly kerfMm?: number
  /**
   * Material thickness in mm. Panel edges are inset so square-cut panels meet at their inner
   * corners (plan §3). 0 / absent = the true face (zero-thickness panels).
   */
  readonly thicknessMm?: number
}

/** Bundle linework and polygons with bounding caps. */
export function prepareMap(
  lines: Partial<Record<LineSourceId, readonly Vec3[][]>>,
  polygons: Partial<Record<PolygonSourceId, readonly SphereRings[]>> = {},
): PreparedMap {
  const outLines: Partial<Record<LineSourceId, PreparedLine[]>> = {}
  for (const [id, ls] of Object.entries(lines) as [LineSourceId, Vec3[][]][]) {
    outLines[id] = ls.map((points) => ({ points, cap: boundingCap(points) }))
  }
  const outPolys: Partial<Record<PolygonSourceId, PreparedPolygon[]>> = {}
  for (const [id, ps] of Object.entries(polygons) as [PolygonSourceId, SphereRings[]][]) {
    outPolys[id] = ps.map((rings) => ({ rings, cap: boundingCap(rings.flat()) }))
  }
  return { lines: outLines, polygons: outPolys }
}

/** Longest edge of the solid in model units (plan §3: longest edge = N mm). */
export function longestEdge(frames: PolyhedronFrames): number {
  const v = frames.def.vertices
  return Math.max(...frames.edges.map((e) => distance(v[e.a]!, v[e.b]!)))
}

/** Apply the globe rotation to all prepared vectors (plan §4.3). */
export function rotateMap(map: PreparedMap, q: Quat): PreparedMap {
  if (q.every((c, i) => c === IDENTITY[i])) return map
  const rotCap = (cap: Cap): Cap => ({ centre: rotate(q, cap.centre), radius: cap.radius })
  const lines: Partial<Record<LineSourceId, PreparedLine[]>> = {}
  for (const [id, ls] of Object.entries(map.lines) as [LineSourceId, PreparedLine[]][]) {
    lines[id] = ls.map(({ points, cap }) => ({
      points: points.map((p) => rotate(q, p)),
      cap: rotCap(cap),
    }))
  }
  const polygons: Partial<Record<PolygonSourceId, PreparedPolygon[]>> = {}
  for (const [id, ps] of Object.entries(map.polygons) as [PolygonSourceId, PreparedPolygon[]][]) {
    polygons[id] = ps.map(({ rings, cap }) => ({
      rings: rings.map((r) => r.map((p) => rotate(q, p))),
      cap: rotCap(cap),
    }))
  }
  return { lines, polygons }
}

/** Face-frame (model units) → output mm: scale, then the panel's export rotation. */
interface OutputTransform {
  readonly face: FaceFrame
  /** cos·scale, sin·scale */
  readonly a: number
  readonly b: number
}

const toOutput = ({ a, b }: OutputTransform, [x, y]: Vec2): Vec2 => [a * x - b * y, b * x + a * y]

function projectRun(t: OutputTransform, run: readonly Vec3[]): Vec2[] {
  return run.map((p) => {
    const xy = gnomonic(t.face, p)
    // Clipped points are inside the face cone, so always in front of the plane.
    if (!xy) throw new Error(`face ${t.face.index}: clipped point behind the face plane`)
    return toOutput(t, xy)
  })
}

/**
 * Clip a polygon set to the face on the sphere, project, and union in 2D. Rings are reversed
 * on projection: d3 exteriors are clockwise seen from outside, and the face frame is seen from
 * outside, so this makes exteriors counter-clockwise for Clipper's Positive fill rule.
 */
function projectPolygons(
  t: OutputTransform,
  cap: Cap,
  planes: readonly Vec3[],
  polygons: readonly PreparedPolygon[],
) {
  const rings: Vec2[][] = []
  for (const poly of polygons) {
    if (!capsOverlap(cap, poly.cap)) continue
    for (const ring of poly.rings) {
      const clipped = clipRingToCone(ring, planes)
      if (clipped.length >= 3) rings.push(projectRun(t, clipped).reverse())
    }
  }
  return unionPositive(toPaths64(rings))
}

/** Clip, project, scale and round one face's artwork (plan §4.4). `map` is already rotated. */
export function buildFaceArtwork(
  frames: PolyhedronFrames,
  faceIndex: number,
  map: PreparedMap,
  {
    mmPerUnit,
    precisionMm,
    fills: want = {},
    north,
    kerfMm = 0,
    thicknessMm = 0,
  }: ArtworkOptions,
): FaceArtwork {
  const face = frames.faces[faceIndex]
  if (!face) throw new Error(`no face ${faceIndex}`)
  const finish = (pts: Vec2[]) => (precisionMm === null ? pts : roundPolyline(pts, precisionMm))
  // The true face's cap still bounds the (smaller) panel, so it remains valid for culling.
  const cap = faceCap(face)
  // Clip on the sphere to the panel's cone: exact, because gnomonic projection maps its planes
  // to the panel edges. With no thickness these are the face's own (shared-edge exact) planes.
  const panel = panelOutline(frames, faceIndex, thicknessMm / mmPerUnit)
  const planes = thicknessMm > 0 ? polygonConePlanes(face, panel) : face.edgePlanes
  const rotation = north ? northUpRotation(face, north) : 0
  const t: OutputTransform = {
    face,
    a: Math.cos(rotation) * mmPerUnit,
    b: Math.sin(rotation) * mmPerUnit,
  }

  const lines: Partial<Record<LineSourceId, Vec2[][]>> = {}
  for (const [id, ls] of Object.entries(map.lines) as [LineSourceId, PreparedLine[]][]) {
    const polylines: Vec2[][] = []
    for (const line of ls) {
      if (!capsOverlap(cap, line.cap)) continue
      for (const run of clipPolylineToCone(line.points, planes)) {
        const pts = finish(projectRun(t, run))
        if (pts.length >= 2) polylines.push(pts)
      }
    }
    lines[id] = polylines
  }

  const outlineExact = panel.map((p) => toOutput(t, p))
  const fills: Partial<Record<FillLayerId, Vec2[][]>> = {}
  if (want.land || want.ocean || want.lakes) {
    const polys = (id: PolygonSourceId) => projectPolygons(t, cap, planes, map.polygons[id] ?? [])
    const land = want.land || want.ocean ? polys('land') : []
    const lakes = want.land || want.lakes ? polys('lakes') : []
    // Land excludes lakes, so a land fill never engraves over open water.
    if (want.land) fills.land = fromPaths64(subtract(land, lakes), precisionMm)
    if (want.lakes) fills.lakes = fromPaths64(lakes, precisionMm)
    if (want.ocean)
      fills.ocean = fromPaths64(subtract(toPaths64([outlineExact]), land), precisionMm)
  }

  const outline = finish(outlineExact)
  const cutOutline = kerfMm > 0 ? finish(offsetPolygon(outlineExact, kerfMm / 2)) : outline
  return { faceIndex, rotation, outline, cutOutline, lines, fills }
}

/** Artwork for every face. */
export function buildAllFaces(
  frames: PolyhedronFrames,
  map: PreparedMap,
  options: ArtworkOptions,
): FaceArtwork[] {
  return frames.faces.map((_, i) => buildFaceArtwork(frames, i, map, options))
}
