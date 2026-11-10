import { useEffect, useRef } from 'react'

import { projector } from '@/ui/projector-client'
import { useAppStore } from '@/ui/store'

const DEBOUNCE_MS = 120

/**
 * Keeps the worker output in step with the settings (plan §3 "Performance"):
 *
 * - Settings change (not dragging): debounced full render at the chosen resolution, with SVGs
 *   for the 2D grid and exports, plus artwork for the 3D textures.
 * - Dragging the globe: a 110m, artwork-only preview loop with at most one request in flight;
 *   whenever one returns, the newest rotation is sent next. The 3D view keeps rendering at full
 *   frame rate while textures catch up.
 *
 * Both paths share one request counter, so a late result from either is discarded.
 */
export function useProjectionSync(): void {
  const polyhedron = useAppStore((s) => s.polyhedron)
  const resolution = useAppStore((s) => s.resolution)
  const edgeLengthMm = useAppStore((s) => s.edgeLengthMm)
  const rotation = useAppStore((s) => s.rotation)
  const layerStyles = useAppStore((s) => s.layerStyles)
  const dragging = useAppStore((s) => s.dragging)
  const latest = useRef(0)

  // Starting a drag invalidates any full render still in flight.
  useEffect(() => {
    if (dragging) latest.current++
  }, [dragging])

  // Full render.
  useEffect(() => {
    if (dragging) return
    const id = ++latest.current
    const { setComputing, setProjection, setArtwork, setError } = useAppStore.getState()
    setComputing()
    const timer = setTimeout(() => {
      projector()
        .project({ polyhedron, resolution, edgeLengthMm, rotation, layerStyles })
        .then((r) => {
          if (id !== latest.current) return
          setArtwork({ shapeId: r.shapeId, mmPerUnit: r.mmPerUnit, faces: r.faces })
          setProjection({
            shape: r.shape,
            svgs: r.svgs ?? [],
            prepareMs: r.prepareMs,
            projectMs: r.projectMs,
          })
        })
        .catch((err: unknown) => {
          if (id === latest.current) setError(err instanceof Error ? err.message : String(err))
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [polyhedron, resolution, edgeLengthMm, rotation, layerStyles, dragging])

  // Interactive preview while dragging.
  useEffect(() => {
    let inFlight = false
    let sent: unknown = null
    const pump = () => {
      const s = useAppStore.getState()
      if (!s.dragging || inFlight || s.rotation === sent) return
      inFlight = true
      sent = s.rotation
      const id = ++latest.current
      projector()
        .project({
          polyhedron: s.polyhedron,
          resolution: '110m',
          edgeLengthMm: s.edgeLengthMm,
          rotation: s.rotation,
          layerStyles: s.layerStyles,
          wantSvg: false,
        })
        .then((r) => {
          if (id === latest.current && useAppStore.getState().dragging) {
            useAppStore
              .getState()
              .setArtwork({ shapeId: r.shapeId, mmPerUnit: r.mmPerUnit, faces: r.faces })
          }
        })
        .catch(() => {
          // A failed preview frame is harmless; the full render on release reports errors.
        })
        .finally(() => {
          inFlight = false
          pump()
        })
    }
    return useAppStore.subscribe(pump)
  }, [])
}
