import { LoaderCircle } from 'lucide-react'
import { Suspense, lazy } from 'react'

import { Label } from '@/ui/components/ui/label'
import { Switch } from '@/ui/components/ui/switch'
import { useAppStore } from '@/ui/store'

// three.js is large; load the 3D view as its own chunk.
const GlobeView = lazy(() => import('@/ui/three/GlobeView'))

const spinner = <LoaderCircle className="size-5 animate-spin text-muted-foreground" />

export function CentrePanel() {
  const computing = useAppStore((s) => s.computing)
  const dragging = useAppStore((s) => s.dragging)
  const error = useAppStore((s) => s.error)
  const showFaceNumbers = useAppStore((s) => s.showFaceNumbers)
  const setShowFaceNumbers = useAppStore((s) => s.setShowFaceNumbers)

  return (
    <main className="flex min-h-0 flex-col bg-muted/30">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-4 py-2">
        <p className="text-xs text-muted-foreground">
          Drag: rotate globe · Right- or Alt-drag: orbit · Wheel: zoom · Double-click a face:
          enlarge
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {(computing || dragging) && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {dragging ? 'Live preview' : 'Projecting…'}
            </span>
          )}
          <Label htmlFor="face-numbers" className="text-xs">
            Face numbers
          </Label>
          <Switch
            id="face-numbers"
            checked={showFaceNumbers}
            onCheckedChange={setShowFaceNumbers}
          />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {error ? (
          <p className="p-6 text-sm text-destructive">Projection failed: {error}</p>
        ) : (
          <Suspense
            fallback={<div className="flex h-full items-center justify-center">{spinner}</div>}
          >
            <GlobeView />
          </Suspense>
        )}
      </div>
    </main>
  )
}
