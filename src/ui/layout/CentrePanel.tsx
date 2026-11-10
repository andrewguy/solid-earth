import { Download, LoaderCircle } from 'lucide-react'

import { faceFileName } from '@/core/export/zip'
import { Button } from '@/ui/components/ui/button'
import { downloadText } from '@/ui/download'
import { useAppStore } from '@/ui/store'

// The selected face's exported SVG, shown as an image so the preview is exactly the file.
// The 3D preview takes over this panel in milestone 6.
export function CentrePanel() {
  const index = useAppStore((s) => s.selectedFace)
  const projection = useAppStore((s) => s.projection)
  const computing = useAppStore((s) => s.computing)
  const error = useAppStore((s) => s.error)
  const face = projection?.faces[index]
  const shapeName = useAppStore((s) => s.polyhedron.def.name)
  const filename = faceFileName(projection?.shape ?? shapeName, index)

  return (
    <main className="flex min-h-0 flex-col bg-muted/30">
      <header className="flex items-center justify-between gap-2 border-b bg-background px-4 py-2">
        <h2 className="font-mono text-sm">{filename}</h2>
        <div className="flex items-center gap-3">
          {computing && <LoaderCircle className="size-4 animate-spin text-muted-foreground" />}
          <Button
            size="sm"
            disabled={!face}
            onClick={() => face && downloadText(filename, face.svg, 'image/svg+xml')}
          >
            <Download /> Download SVG
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {error ? (
          <p className="text-sm text-destructive">Projection failed: {error}</p>
        ) : face ? (
          <img
            src={face.url}
            alt={`Face ${index} artwork`}
            className="h-full w-full rounded-md bg-white object-contain shadow-sm"
          />
        ) : (
          <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
        )}
      </div>
    </main>
  )
}
