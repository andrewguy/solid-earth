import { useMemo } from 'react'

import { DEFAULT_SVG_OPTIONS, faceToSvg } from '@/core/export/svg'
import { prepareLines } from '@/core/geo/lines'
import {
  type CountriesTopology,
  type LandTopology,
  borderLines,
  coastlineLines,
} from '@/core/geo/topojson'
import { type PreparedMap, buildFaceArtwork, longestEdge } from '@/core/pipeline'
import { type PolyhedronFrames, buildFrames } from '@/core/polyhedron/faces'
import { icosahedron } from '@/core/polyhedron/presets'
import countries110m from '@/data/countries-110m.topo.json'
import land110m from '@/data/land-110m.topo.json'
import { useAppStore } from '@/ui/store'

// Milestone 3: main-thread pipeline for a single icosahedron face at 110m.
// Milestone 4 moves this into a web worker and renders all faces.

let cached: { frames: PolyhedronFrames; map: PreparedMap } | null = null

function getModel() {
  cached ??= {
    frames: buildFrames(icosahedron()),
    map: {
      lines: {
        coastlines: prepareLines(coastlineLines(land110m as unknown as LandTopology)),
        borders: prepareLines(borderLines(countries110m as unknown as CountriesTopology)),
      },
    },
  }
  return cached
}

export const FACE_COUNT = 20
export const SHAPE_NAME = 'icosahedron'

export const faceFileName = (index: number) =>
  `${SHAPE_NAME}_face-${String(index).padStart(2, '0')}.svg`

/** SVG for one face with the current settings, exactly as exported. */
export function useFaceSvg(faceIndex: number): string {
  const edgeLengthMm = useAppStore((s) => s.edgeLengthMm)
  const styles = useAppStore((s) => s.layerStyles)
  return useMemo(() => {
    const { frames, map } = getModel()
    const art = buildFaceArtwork(frames, faceIndex, map, {
      mmPerUnit: edgeLengthMm / longestEdge(frames),
      precisionMm: 0.01,
    })
    return faceToSvg(art, { ...DEFAULT_SVG_OPTIONS, styles })
  }, [faceIndex, edgeLengthMm, styles])
}
