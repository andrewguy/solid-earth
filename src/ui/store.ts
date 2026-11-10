import { create } from 'zustand'

import { DEFAULT_LAYER_STYLES, type LayerId, type LayerStyle } from '@/core/layers'

interface AppState {
  edgeLengthMm: number
  selectedFace: number
  layerStyles: Record<LayerId, LayerStyle>
  setEdgeLengthMm: (mm: number) => void
  selectFace: (index: number) => void
  setLayerEnabled: (id: LayerId, enabled: boolean) => void
}

export const useAppStore = create<AppState>()((set) => ({
  edgeLengthMm: 100,
  selectedFace: 0,
  layerStyles: { ...DEFAULT_LAYER_STYLES },
  setEdgeLengthMm: (mm) => {
    if (Number.isFinite(mm) && mm > 0) set({ edgeLengthMm: mm })
  },
  selectFace: (index) => set({ selectedFace: index }),
  setLayerEnabled: (id, enabled) =>
    set((s) => ({ layerStyles: { ...s.layerStyles, [id]: { ...s.layerStyles[id], enabled } } })),
}))
