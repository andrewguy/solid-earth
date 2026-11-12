import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { nestWarnings } from '@/core/nest/status'
import { buildFrames } from '@/core/polyhedron/faces'
import { LARGE_OUTPUT_BYTES, distortion } from '@/core/warnings'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { selectCurrentLayout, selectSettings, useAppStore } from '@/ui/store'

const NO_WARNINGS: readonly string[] = []

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/**
 * Warnings (plan §6.6, §13.4 step 11): projection distortion, large output, and a stale or
 * incomplete sheet layout. Validation errors are toasts.
 */
export function Warnings() {
  const def = useAppStore((s) => s.polyhedron.def)
  const resolution = useAppStore((s) => s.resolution)
  const projection = useAppStore((s) => s.projection)
  const d = useMemo(() => distortion(buildFrames(def)), [def])
  const current = useAppStore(selectCurrentLayout)
  const nest = useAppStore(
    useShallow((s) => (s.nestLayout ? nestWarnings(selectSettings(s)) : NO_WARNINGS)),
  )
  const bytes = useMemo(
    () => projection?.faces.reduce((n, f) => n + f.svg.length, 0) ?? 0,
    [projection],
  )

  const items: { title: string; body: string }[] = []
  if (d.level !== 'low') {
    items.push({
      title: d.level === 'severe' ? 'Severe distortion' : 'Noticeable distortion',
      body:
        `Map features grow up to ${d.areal.toFixed(1)}× in area toward the panel corners ` +
        `(${d.radial.toFixed(1)}× in length). Shapes with more faces, like the icosahedron or ` +
        'truncated icosahedron, stay much closer to true shape.',
    })
  }
  if (bytes > LARGE_OUTPUT_BYTES) {
    items.push({
      title: 'Large output',
      body:
        `The SVGs total ${mb(bytes)} MB. LightBurn may be slow to import and plan the job. ` +
        (resolution === '50m'
          ? 'Try 1:110m, or turn off rivers or fills.'
          : 'Consider turning off rivers or fills.'),
    })
  }
  for (const body of nest) {
    items.push({ title: current ? 'Panels left off the sheets' : 'Sheet layout out of date', body })
  }
  if (items.length === 0) return null

  return (
    <div className="space-y-2">
      {items.map((w) => (
        <Alert key={w.title}>
          <TriangleAlert />
          <AlertTitle>{w.title}</AlertTitle>
          <AlertDescription className="text-xs">{w.body}</AlertDescription>
        </Alert>
      ))}
    </div>
  )
}
