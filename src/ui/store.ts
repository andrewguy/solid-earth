import { create } from 'zustand'

import { DEFAULT_LAYER_STYLES, type LayerId, type LayerStyle } from '@/core/layers'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import { IDENTITY, type Quat } from '@/core/quat'
import type { ProjectSettings, Resolution } from '@/core/settings'
import type { PackedFace } from '@/worker/projector'

export interface FaceOutput {
  readonly svg: string
  /** Object URL of `svg`, for <img>. Revoked when replaced. */
  readonly url: string
}

export interface Projection {
  readonly shape: string
  readonly faces: readonly FaceOutput[]
  readonly prepareMs: number
  readonly projectMs: number
}

/** Projected linework for the 3D textures (updated live while dragging). */
export interface Artwork {
  readonly shapeId: string
  /** The rotation this artwork was projected with (same object as the store's, if current). */
  readonly rotation: Quat
  readonly mmPerUnit: number
  readonly faces: readonly PackedFace[]
}

/** A polyhedron plus a stable id for caching: the preset id, or `custom:<n>`. */
export interface ShapeChoice {
  readonly id: string
  readonly def: PolyhedronDef
}

let customCounter = 0

interface AppState {
  // Settings (saved in the project file)
  polyhedron: ShapeChoice
  /** The last imported custom shape, kept so the picker can switch back to it. */
  custom: ShapeChoice | null
  rotation: Quat
  edgeLengthMm: number
  resolution: Resolution
  layerStyles: Record<LayerId, LayerStyle>
  // UI / derived
  selectedFace: number
  /** Face shown enlarged in the dialog, or null. */
  enlargedFace: number | null
  showFaceNumbers: boolean
  /** True while the user is dragging the globe: previews run at 110m. */
  dragging: boolean
  projection: Projection | null
  artwork: Artwork | null
  computing: boolean
  error: string | null

  setPreset: (id: PresetId) => void
  setCustom: (def: PolyhedronDef) => void
  chooseCustom: () => void
  setEdgeLengthMm: (mm: number) => void
  setResolution: (r: Resolution) => void
  selectFace: (index: number) => void
  enlargeFace: (index: number | null) => void
  setShowFaceNumbers: (on: boolean) => void
  setRotation: (q: Quat) => void
  resetRotation: () => void
  setDragging: (dragging: boolean) => void
  setArtwork: (artwork: Artwork) => void
  setLayerEnabled: (id: LayerId, enabled: boolean) => void
  setComputing: () => void
  setProjection: (p: Omit<Projection, 'faces'> & { svgs: readonly string[] }) => void
  setError: (message: string) => void
}

export const useAppStore = create<AppState>()((set, get) => ({
  polyhedron: { id: 'icosahedron', def: preset('icosahedron') },
  custom: null,
  rotation: IDENTITY,
  edgeLengthMm: 100,
  resolution: '50m',
  layerStyles: { ...DEFAULT_LAYER_STYLES },
  selectedFace: 0,
  enlargedFace: null,
  showFaceNumbers: false,
  dragging: false,
  projection: null,
  artwork: null,
  computing: false,
  error: null,

  setPreset: (id) => set({ polyhedron: { id, def: preset(id) }, selectedFace: 0 }),
  setCustom: (def) => {
    const choice = { id: `custom:${++customCounter}`, def }
    set({ polyhedron: choice, custom: choice, selectedFace: 0 })
  },
  chooseCustom: () => {
    const { custom } = get()
    if (custom) set({ polyhedron: custom, selectedFace: 0 })
  },
  setEdgeLengthMm: (mm) => {
    if (Number.isFinite(mm) && mm > 0) set({ edgeLengthMm: mm })
  },
  setResolution: (resolution) => set({ resolution }),
  selectFace: (index) => set({ selectedFace: index }),
  enlargeFace: (index) =>
    set(index === null ? { enlargedFace: null } : { enlargedFace: index, selectedFace: index }),
  setShowFaceNumbers: (on) => set({ showFaceNumbers: on }),
  setRotation: (rotation) => set({ rotation }),
  resetRotation: () => set({ rotation: IDENTITY }),
  setDragging: (dragging) => set({ dragging }),
  setArtwork: (artwork) => set({ artwork }),
  setLayerEnabled: (id, enabled) =>
    set((s) => ({ layerStyles: { ...s.layerStyles, [id]: { ...s.layerStyles[id], enabled } } })),
  setComputing: () => set({ computing: true }),
  setProjection: ({ svgs, ...rest }) => {
    for (const f of get().projection?.faces ?? []) URL.revokeObjectURL(f.url)
    const faces = svgs.map((svg) => ({
      svg,
      url: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
    }))
    set({ projection: { ...rest, faces }, computing: false, error: null })
  },
  setError: (message) => set({ computing: false, error: message }),
}))

/** The settings that define the exported files, as stored in project.json. */
export const selectSettings = (s: AppState): ProjectSettings => ({
  polyhedron: s.polyhedron.def,
  rotation: s.rotation,
  edgeLengthMm: s.edgeLengthMm,
  resolution: s.resolution,
  layerStyles: s.layerStyles,
})
