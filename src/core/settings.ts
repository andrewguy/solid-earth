import type { LayerId, LayerStyle } from './layers'
import type { PolyhedronDef } from './polyhedron/types'
import type { Quat } from './quat'

export const RESOLUTIONS = ['110m', '50m'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

/** Everything that determines the exported files. Grows with later milestones. */
export interface ProjectSettings {
  /**
   * The normalised polyhedron, embedded so custom shapes survive save/load (plan §3).
   * `name` doubles as the export file-name prefix.
   */
  readonly polyhedron: PolyhedronDef
  readonly rotation: Quat
  readonly edgeLengthMm: number
  readonly resolution: Resolution
  readonly layerStyles: Readonly<Record<LayerId, LayerStyle>>
}
