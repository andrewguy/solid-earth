import { BUTT, type FingerParams, type JointOptions, fingerParams, fingeredOutline } from './joints'
import { panelOutline } from './panel'
import { offsetPolygon } from './planar/clipper'
import type { PolyhedronFrames } from './polyhedron/faces'
import { northUpRotation } from './project/orientation'
import type { Vec2, Vec3 } from './vec3'

/** What determines a panel's cut shape: everything but the map. */
export interface PanelShapeOptions {
  /** Model units → mm. */
  readonly mmPerUnit: number
  /** Laser kerf in mm; the cut path is offset outward by half of it. 0 / absent = off. */
  readonly kerfMm?: number
  /** Material thickness in mm. 0 / absent = the true face (zero-thickness panels). */
  readonly thicknessMm?: number
  /** Joint style (plan §12). Default: square-cut butt joints. */
  readonly joint?: JointOptions
  /**
   * Geographic north in world space. When given, `rotation` is the panel's north-up export
   * rotation (plan §3); otherwise it is 0.
   */
  readonly north?: Vec3
}

/**
 * One panel's cut shape in the face's own (u, v) frame, in mm, y up, unrounded. This is the
 * frame `FaceArtwork` uses before its export rotation, so it doesn't depend on the globe
 * rotation (plan §13.3).
 */
export interface PanelShape {
  readonly faceIndex: number
  /** The panel as cut (before kerf), CCW. */
  readonly outline: readonly Vec2[]
  /** Path to cut: the outline offset outward by kerf/2, or the outline itself. */
  readonly cutOutline: readonly Vec2[]
  /** North-up export rotation (radians, CCW); export frame = R(rotation) · face frame. */
  readonly rotation: number
}

/** Finger parameters in model units, or null when the panel has butt joints. */
export function panelFingers(
  joint: JointOptions,
  thicknessMm: number,
  mmPerUnit: number,
): FingerParams | null {
  return joint.kind === 'finger' && thicknessMm > 0
    ? fingerParams(joint, thicknessMm, mmPerUnit)
    : null
}

/**
 * The panel as cut (before kerf) in the face's frame, in model units: fingered when `fingers` is
 * given, otherwise the face with each edge inset for square-cut butt joints.
 */
export function panelModelOutline(
  frames: PolyhedronFrames,
  faceIndex: number,
  thicknessMm: number,
  mmPerUnit: number,
  fingers: FingerParams | null,
): Vec2[] {
  return fingers
    ? fingeredOutline(frames, faceIndex, fingers)
    : panelOutline(frames, faceIndex, thicknessMm / mmPerUnit)
}

/** One panel's cut shape, without projecting any map data. */
export function panelShape(
  frames: PolyhedronFrames,
  faceIndex: number,
  { mmPerUnit, kerfMm = 0, thicknessMm = 0, joint = BUTT, north }: PanelShapeOptions,
): PanelShape {
  const face = frames.faces[faceIndex]
  if (!face) throw new Error(`no face ${faceIndex}`)
  const fingers = panelFingers(joint, thicknessMm, mmPerUnit)
  const outline = panelModelOutline(frames, faceIndex, thicknessMm, mmPerUnit, fingers).map(
    ([x, y]): Vec2 => [x * mmPerUnit, y * mmPerUnit],
  )
  const cutOutline = kerfMm > 0 ? offsetPolygon(outline, kerfMm / 2) : outline
  const rotation = north ? northUpRotation(face, north) : 0
  return { faceIndex, outline, cutOutline, rotation }
}

/** Cut shapes for every face. */
export function panelShapes(frames: PolyhedronFrames, options: PanelShapeOptions): PanelShape[] {
  return frames.faces.map((_, i) => panelShape(frames, i, options))
}
