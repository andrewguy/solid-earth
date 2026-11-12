import { useEffect, useRef } from 'react'

import { jointOptions } from '@/core/settings'
import { MAX_LIVE_FACES } from '@/ui/constants'
import { projector } from '@/ui/projector-client'
import { selectCurrentLayout, useAppStore } from '@/ui/store'

const DEBOUNCE_MS = 120

/**
 * Keeps the worker output in step with the settings (plan §3 "Performance"):
 *
 * - Settings change (not dragging): debounced full render at the chosen resolution, with SVGs
 *   for the 2D grid and exports, plus artwork for the 3D textures.
 * - Dragging the globe: the 3D view draws the linework live on the GPU, so no worker requests
 *   are needed. Only shapes with more than MAX_LIVE_FACES faces fall back to a 110m,
 *   artwork-only preview loop (at most one request in flight, newest rotation wins).
 * - Releasing a drag renders immediately (no debounce).
 *
 * Both paths share one request counter, so a late result from either is discarded.
 */
export function useProjectionSync(): void {
  const polyhedron = useAppStore((s) => s.polyhedron)
  const resolution = useAppStore((s) => s.resolution)
  const edgeLengthMm = useAppStore((s) => s.edgeLengthMm)
  const rotation = useAppStore((s) => s.rotation)
  const layerStyles = useAppStore((s) => s.layerStyles)
  const graticuleIntervalDeg = useAppStore((s) => s.graticuleIntervalDeg)
  const kerfMm = useAppStore((s) => (s.kerfEnabled ? s.kerfMm : 0))
  const thicknessMm = useAppStore((s) => s.thicknessMm)
  const jointKind = useAppStore((s) => s.joint)
  const fingerWidthMm = useAppStore((s) => s.fingerWidthMm)
  const fingerTip = useAppStore((s) => s.fingerTip)
  const fingerClearanceMm = useAppStore((s) => s.fingerClearanceMm)
  const dragging = useAppStore((s) => s.dragging)
  // Sheets are rendered only for a layout that is current (plan §13.4 step 9).
  const layout = useAppStore(selectCurrentLayout)
  const sheetOutline = useAppStore((s) => s.nest.sheetOutline)
  const latest = useRef(0)
  const wasDragging = useRef(false)

  // Starting a drag invalidates any full render still in flight.
  useEffect(() => {
    if (dragging) latest.current++
  }, [dragging])

  // Full render.
  useEffect(() => {
    const justReleased = wasDragging.current && !dragging
    wasDragging.current = dragging
    if (dragging) return
    const id = ++latest.current
    const joint = jointOptions({ joint: jointKind, fingerWidthMm, fingerTip, fingerClearanceMm })
    const { setComputing, setProjection, setArtwork, setError } = useAppStore.getState()
    setComputing()
    const timer = setTimeout(
      () => {
        projector()
          .project({
            polyhedron,
            resolution,
            edgeLengthMm,
            rotation,
            layerStyles,
            graticuleIntervalDeg,
            kerfMm,
            thicknessMm,
            joint,
            sheets: layout
              ? { layout, nest: useAppStore.getState().nest, outline: sheetOutline }
              : undefined,
          })
          .then((r) => {
            if (id !== latest.current) return
            setArtwork({ shapeId: r.shapeId, rotation, mmPerUnit: r.mmPerUnit, faces: r.faces })
            setProjection({
              shape: r.shape,
              svgs: r.svgs ?? [],
              sheetSvgs: r.sheetSvgs,
              prepareMs: r.prepareMs,
              projectMs: r.projectMs,
            })
          })
          .catch((err: unknown) => {
            if (id === latest.current) setError(err instanceof Error ? err.message : String(err))
          })
      },
      justReleased ? 0 : DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [
    polyhedron,
    resolution,
    edgeLengthMm,
    rotation,
    layerStyles,
    graticuleIntervalDeg,
    kerfMm,
    thicknessMm,
    jointKind,
    fingerWidthMm,
    fingerTip,
    fingerClearanceMm,
    dragging,
    layout,
    sheetOutline,
  ])

  // Interactive preview while dragging.
  useEffect(() => {
    let inFlight = false
    let sent: unknown = null
    const pump = () => {
      const s = useAppStore.getState()
      if (!s.dragging || inFlight || s.rotation === sent) return
      if (s.polyhedron.def.faces.length <= MAX_LIVE_FACES) return // drawn live on the GPU
      inFlight = true
      sent = s.rotation
      const id = ++latest.current
      const rotation = s.rotation
      projector()
        .project({
          polyhedron: s.polyhedron,
          resolution: '110m',
          edgeLengthMm: s.edgeLengthMm,
          rotation,
          layerStyles: s.layerStyles,
          graticuleIntervalDeg: s.graticuleIntervalDeg,
          thicknessMm: s.thicknessMm,
          joint: jointOptions(s),
          wantSvg: false,
        })
        .then((r) => {
          if (id === latest.current && useAppStore.getState().dragging) {
            useAppStore
              .getState()
              .setArtwork({ shapeId: r.shapeId, rotation, mmPerUnit: r.mmPerUnit, faces: r.faces })
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

/** Runs the sync in its own component, so rotation changes don't re-render the whole app. */
export function ProjectionSync(): null {
  useProjectionSync()
  return null
}
