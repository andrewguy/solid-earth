import { DEFAULT_LAYER_STYLES, type LayerId, type LayerStyle } from './layers'
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
  /** Material thickness (plan §6.3). Butt joints keep the outer surface at the true face. */
  readonly thicknessMm: number
  /** Kerf compensation (plan §3): off by default so LightBurn's own offset can be used. */
  readonly kerfEnabled: boolean
  readonly kerfMm: number
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
}
