import { create } from 'zustand'

import type { LayerId, LayerStyle } from '@/core/layers'
import { type PresetId, isPresetId, preset } from '@/core/polyhedron/presets'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import { IDENTITY, type Quat } from '@/core/quat'
import type { FingerTip } from '@/core/joints'
import {
  DEFAULT_SETTINGS,
  type JointKind,
  type ProjectSettings,
  type Resolution,
} from '@/core/settings'
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
const customChoice = (def: PolyhedronDef): ShapeChoice => ({ id: `custom:${++customCounter}`, def })

/** Store fields for a set of project settings. */
function fromSettings(s: ProjectSettings) {
  const polyhedron: ShapeChoice =
    s.preset && isPresetId(s.preset)
      ? { id: s.preset, def: preset(s.preset) }
      : customChoice(s.polyhedron)
  return {
    polyhedron,
    rotation: s.rotation,
    edgeLengthMm: s.edgeLengthMm,
    resolution: s.resolution,
    layerStyles: { ...s.layerStyles },
    graticuleIntervalDeg: s.graticuleIntervalDeg,
    thicknessMm: s.thicknessMm,
    kerfEnabled: s.kerfEnabled,
    kerfMm: s.kerfMm,
    joint: s.joint,
    fingerWidthMm: s.fingerWidthMm,
    fingerTip: s.fingerTip,
    fingerClearanceMm: s.fingerClearanceMm,
  }
}

interface AppState {
  // Settings (saved in the project file)
  polyhedron: ShapeChoice
  /** The last imported custom shape, kept so the picker can switch back to it. */
  custom: ShapeChoice | null
  rotation: Quat
  edgeLengthMm: number
  resolution: Resolution
  layerStyles: Record<LayerId, LayerStyle>
  graticuleIntervalDeg: number
  thicknessMm: number
  kerfEnabled: boolean
  kerfMm: number
  joint: JointKind
  fingerWidthMm: number
  fingerTip: FingerTip
  fingerClearanceMm: number
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

  /** Replace all project settings (open, autosave restore, new project). */
  applySettings: (settings: ProjectSettings) => void
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
  setLayerStyle: (id: LayerId, patch: Partial<Omit<LayerStyle, 'label'>>) => void
  setGraticuleIntervalDeg: (deg: number) => void
  setThicknessMm: (mm: number) => void
  setKerfEnabled: (on: boolean) => void
  setKerfMm: (mm: number) => void
  setJoint: (joint: JointKind) => void
  setFingerWidthMm: (mm: number) => void
  setFingerTip: (tip: FingerTip) => void
  setFingerClearanceMm: (mm: number) => void
  setComputing: () => void
  setProjection: (p: Omit<Projection, 'faces'> & { svgs: readonly string[] }) => void
  setError: (message: string) => void
}

export const useAppStore = create<AppState>()((set, get) => ({
  ...fromSettings(DEFAULT_SETTINGS),
  custom: null,
  selectedFace: 0,
  enlargedFace: null,
  showFaceNumbers: false,
  dragging: false,
  projection: null,
  artwork: null,
  computing: false,
  error: null,

  applySettings: (settings) => {
    const fields = fromSettings(settings)
    const isCustom = !isPresetId(fields.polyhedron.id)
    set({
      ...fields,
      ...(isCustom ? { custom: fields.polyhedron } : {}),
      selectedFace: 0,
      enlargedFace: null,
    })
  },
  setPreset: (id) => set({ polyhedron: { id, def: preset(id) }, selectedFace: 0 }),
  setCustom: (def) => {
    const choice = customChoice(def)
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
  setLayerEnabled: (id, enabled) => get().setLayerStyle(id, { enabled }),
  setLayerStyle: (id, patch) =>
    set((s) => ({ layerStyles: { ...s.layerStyles, [id]: { ...s.layerStyles[id], ...patch } } })),
  setGraticuleIntervalDeg: (deg) => set({ graticuleIntervalDeg: deg }),
  setThicknessMm: (mm) => {
    if (Number.isFinite(mm) && mm > 0) set({ thicknessMm: mm })
  },
  setKerfEnabled: (on) => set({ kerfEnabled: on }),
  setKerfMm: (mm) => {
    if (Number.isFinite(mm) && mm >= 0 && mm < 5) set({ kerfMm: mm })
  },
  setJoint: (joint) => set({ joint }),
  setFingerWidthMm: (mm) => {
    if (Number.isFinite(mm) && mm > 0) set({ fingerWidthMm: mm })
  },
  setFingerTip: (fingerTip) => set({ fingerTip }),
  setFingerClearanceMm: (mm) => {
    if (Number.isFinite(mm) && mm > -1 && mm < 1) set({ fingerClearanceMm: mm })
  },
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
  preset: isPresetId(s.polyhedron.id) ? s.polyhedron.id : null,
  polyhedron: s.polyhedron.def,
  rotation: s.rotation,
  edgeLengthMm: s.edgeLengthMm,
  resolution: s.resolution,
  layerStyles: s.layerStyles,
  graticuleIntervalDeg: s.graticuleIntervalDeg,
  thicknessMm: s.thicknessMm,
  kerfEnabled: s.kerfEnabled,
  kerfMm: s.kerfMm,
  joint: s.joint,
  fingerWidthMm: s.fingerWidthMm,
  fingerTip: s.fingerTip,
  fingerClearanceMm: s.fingerClearanceMm,
})
