import { useEffect, useRef } from 'react'

import { projector } from '@/ui/projector-client'
import { useAppStore } from '@/ui/store'

const DEBOUNCE_MS = 120

/**
 * Re-run the worker pipeline whenever output-affecting settings change. Requests are
 * debounced (typing an edge length) and stale results are dropped.
 */
export function useProjectionSync(): void {
  const polyhedron = useAppStore((s) => s.polyhedron)
  const resolution = useAppStore((s) => s.resolution)
  const edgeLengthMm = useAppStore((s) => s.edgeLengthMm)
  const rotation = useAppStore((s) => s.rotation)
  const layerStyles = useAppStore((s) => s.layerStyles)
  const latest = useRef(0)

  useEffect(() => {
    const id = ++latest.current
    const { setComputing, setProjection, setError } = useAppStore.getState()
    setComputing()
    const timer = setTimeout(() => {
      projector()
        .project({ polyhedron, resolution, edgeLengthMm, rotation, layerStyles })
        .then((result) => {
          if (id === latest.current) setProjection(result)
        })
        .catch((err: unknown) => {
          if (id === latest.current) setError(err instanceof Error ? err.message : String(err))
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [polyhedron, resolution, edgeLengthMm, rotation, layerStyles])
}
