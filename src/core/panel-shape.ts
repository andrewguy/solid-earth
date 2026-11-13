import { BUTT, type FingerParams, type JointOptions, fingerParams, fingeredOutline } from './joints'
import { bevelOutlines, panelOutline } from './panel'
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
  /** Joint style (plan §12, §14). Default: square-cut butt joints. */
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
  /** Bevel mode only: the engraved sanding guide (the true face, plan §14.1). */
  readonly guide?: readonly Vec2[]
  /** North-up export rotation (radians, CCW); export frame = R(rotation) · face frame. */
  readonly rotation: number
}

/** Finger parameters in model units, or null when the panel has no finger joints. */
export function panelFingers(
  joint: JointOptions,
  thicknessMm: number,
  mmPerUnit: number,
): FingerParams | null {
  return joint.kind === 'finger' && thicknessMm > 0
    ? fingerParams(joint, thicknessMm, mmPerUnit)
    : null
}

/** One panel in the face's frame, in model units, before kerf. */
export interface PanelModel {
  /** The panel as cut (before kerf), CCW. */
  readonly outline: Vec2[]
  /** Bevel mode: the engraved sanding guide (the true face). Otherwise null. */
  readonly guide: Vec2[] | null
  /** Finger parameters in finger mode, otherwise null. */
  readonly fingers: FingerParams | null
}

/**
 * The panel as cut (before kerf) in the face's frame, in model units: fingered in finger mode,
 * the true face plus the sanding allowance in bevel mode (plan §14.1), otherwise the face with
 * each edge inset for square-cut butt joints.
 */
export function panelModel(
  frames: PolyhedronFrames,
  faceIndex: number,
  thicknessMm: number,
  mmPerUnit: number,
  joint: JointOptions,
): PanelModel {
  if (joint.kind === 'bevel') {
    const { guide, cut } = bevelOutlines(
      frames,
      faceIndex,
      thicknessMm / mmPerUnit,
      joint.allowanceMm / mmPerUnit,
    )
    return { outline: cut, guide, fingers: null }
  }
  const fingers = panelFingers(joint, thicknessMm, mmPerUnit)
  const outline = fingers
    ? fingeredOutline(frames, faceIndex, fingers)
    : panelOutline(frames, faceIndex, thicknessMm / mmPerUnit)
  return { outline, guide: null, fingers }
}

/** One panel's cut shape, without projecting any map data. */
export function panelShape(
  frames: PolyhedronFrames,
  faceIndex: number,
  { mmPerUnit, kerfMm = 0, thicknessMm = 0, joint = BUTT, north }: PanelShapeOptions,
): PanelShape {
  const face = frames.faces[faceIndex]
  if (!face) throw new Error(`no face ${faceIndex}`)
  const model = panelModel(frames, faceIndex, thicknessMm, mmPerUnit, joint)
  const toMm = (pts: readonly Vec2[]) => pts.map(([x, y]): Vec2 => [x * mmPerUnit, y * mmPerUnit])
  const outline = toMm(model.outline)
  const cutOutline = kerfMm > 0 ? offsetPolygon(outline, kerfMm / 2) : outline
  const rotation = north ? northUpRotation(face, north) : 0
  return {
    faceIndex,
    outline,
    cutOutline,
    ...(model.guide && { guide: toMm(model.guide) }),
    rotation,
  }
}

/** Cut shapes for every face. */
export function panelShapes(frames: PolyhedronFrames, options: PanelShapeOptions): PanelShape[] {
  return frames.faces.map((_, i) => panelShape(frames, i, options))
}
