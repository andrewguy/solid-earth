import { LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react'
import { Suspense, lazy } from 'react'

import { ErrorBoundary } from '@/ui/ErrorBoundary'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'
import { Switch } from '@/ui/components/ui/switch'
import { useAppStore } from '@/ui/store'

// three.js is large; load the 3D view as its own chunk.
const GlobeView = lazy(() => import('@/ui/three/GlobeView'))

const spinner = <LoaderCircle className="size-5 animate-spin text-muted-foreground" />

/**
 * Shown when the 3D view fails, most often because WebGL is unavailable (old GPU, blocked driver,
 * some VMs). Everything else keeps working: the 3D view is only a preview.
 */
function GlobeUnavailable({ error, reset }: { error: Error; reset: () => void }) {
  const webgl = /webgl/i.test(error.message)
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Alert className="max-w-md">
        <TriangleAlert />
        <AlertTitle>3D preview unavailable</AlertTitle>
        <AlertDescription className="space-y-3 text-xs">
          <p>
            {webgl
              ? 'This browser could not start WebGL, which the 3D view needs. Check that hardware acceleration is on, or try another browser.'
              : `The 3D view stopped with an error: ${error.message}`}
          </p>
          <p>Face previews, sheets and all exports still work.</p>
          <Button size="sm" variant="outline" onClick={reset}>
            <RotateCcw /> Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

export function CentrePanel() {
  const computing = useAppStore((s) => s.computing)
  const dragging = useAppStore((s) => s.dragging)
  const error = useAppStore((s) => s.error)
  const showFaceNumbers = useAppStore((s) => s.showFaceNumbers)
  const setShowFaceNumbers = useAppStore((s) => s.setShowFaceNumbers)

  return (
    <main className="flex min-h-0 min-w-0 flex-col bg-muted/30">
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
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {error ? (
          <p className="p-6 text-sm text-destructive">Projection failed: {error}</p>
        ) : (
          // Outside Suspense, so a failed chunk load is contained too.
          <ErrorBoundary fallback={(e, reset) => <GlobeUnavailable error={e} reset={reset} />}>
            <Suspense
              fallback={<div className="flex h-full items-center justify-center">{spinner}</div>}
            >
              <GlobeView />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </main>
  )
}
