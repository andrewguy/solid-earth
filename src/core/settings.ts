import type { FingerTip, JointOptions } from './joints'
import { DEFAULT_LAYER_STYLES, type LayerId, type LayerStyle } from './layers'
import { DEFAULT_NEST_SETTINGS, type NestLayout, type NestSettings } from './nest/types'
import { preset } from './polyhedron/presets'
import type { PolyhedronDef } from './polyhedron/types'
import { IDENTITY, type Quat } from './quat'

export const RESOLUTIONS = ['110m', '50m'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

/** Everything that determines the exported files. Grows with later milestones. */
export interface ProjectSettings {
  /** Preset id when the shape is a built-in preset (rebuilt from code on load), else null. */
  readonly preset: string | null
  /**
   * The normalised polyhedron, embedded so custom shapes survive save/load (plan §3).
   * `name` doubles as the export file-name prefix.
   */
  readonly polyhedron: PolyhedronDef
  readonly rotation: Quat
  readonly edgeLengthMm: number
  readonly resolution: Resolution
  readonly layerStyles: Readonly<Record<LayerId, LayerStyle>>
  /** Graticule spacing in degrees (plan §6.2, default 15°). */
  readonly graticuleIntervalDeg: number
  /**
   * Material thickness (plan §6.3). Square-cut butt joints inset each panel edge so the inner
   * corners meet, leaving a V-groove on the outside.
   */
  readonly thicknessMm: number
  /** Kerf compensation (plan §3): off by default so LightBurn's own offset can be used. */
  readonly kerfEnabled: boolean
  readonly kerfMm: number
  /** Joint style (plan §12): square-cut butt joints, or finger joints. */
  readonly joint: JointKind
  readonly fingerWidthMm: number
  readonly fingerTip: FingerTip
  /** Per side; negative for a press fit. */
  readonly fingerClearanceMm: number
  /** Sheet nesting (plan §13). */
  readonly nest: NestSettings
  /** The last nesting result, or null; stale when `nestInputKey` no longer matches. */
  readonly nestLayout: NestLayout | null
}

export const JOINT_KINDS = ['butt', 'finger'] as const
export type JointKind = (typeof JOINT_KINDS)[number]
export const FINGER_TIPS: readonly FingerTip[] = ['fill', 'flush']

/** The joint options the pipeline needs, from the project settings. */
export function jointOptions(
  s: Pick<ProjectSettings, 'joint' | 'fingerWidthMm' | 'fingerTip' | 'fingerClearanceMm'>,
): JointOptions {
  return s.joint === 'finger'
    ? {
        kind: 'finger',
        widthMm: s.fingerWidthMm,
        tip: s.fingerTip,
        clearanceMm: s.fingerClearanceMm,
      }
    : { kind: 'butt' }
}

export const GRATICULE_INTERVALS = [5, 10, 15, 20, 30] as const

/** A new project (plan §3 defaults). */
export const DEFAULT_SETTINGS: ProjectSettings = {
  preset: 'icosahedron',
  polyhedron: preset('icosahedron'),
  rotation: IDENTITY,
  edgeLengthMm: 100,
  resolution: '50m',
  layerStyles: DEFAULT_LAYER_STYLES,
  graticuleIntervalDeg: 15,
  thicknessMm: 3,
  kerfEnabled: false,
  kerfMm: 0.15,
  joint: 'butt',
  fingerWidthMm: 10,
  fingerTip: 'fill',
  fingerClearanceMm: 0.1,
  nest: DEFAULT_NEST_SETTINGS,
  nestLayout: null,
}
