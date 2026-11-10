import { WorldMap } from '@/ui/preview/WorldMap'

export function CentrePanel() {
  return (
    <main className="flex min-h-0 flex-col items-center justify-center gap-3 bg-muted/30 p-6">
      <WorldMap className="w-full max-w-5xl" />
      <p className="text-xs text-muted-foreground">
        Data pipeline check: Natural Earth 1:110m land, plain d3-geo. The 3D preview replaces this
        in milestone 6.
      </p>
    </main>
  )
}
