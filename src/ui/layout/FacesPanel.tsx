import { Download, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import { serializeProject } from '@/core/export/project-file'
import { buildFacesZip, zipFileName } from '@/core/export/zip'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { Separator } from '@/ui/components/ui/separator'
import { downloadBlob } from '@/ui/download'
import { selectSettings, useAppStore } from '@/ui/store'

export function FacesPanel() {
  const projection = useAppStore((s) => s.projection)
  const computing = useAppStore((s) => s.computing)
  const selected = useAppStore((s) => s.selectedFace)
  const selectFace = useAppStore((s) => s.selectFace)
  const [zipping, setZipping] = useState(false)

  async function exportZip() {
    if (!projection) return
    setZipping(true)
    try {
      const project = serializeProject(selectSettings(useAppStore.getState()))
      const bytes = await buildFacesZip(
        projection.shape,
        projection.faces.map((f) => f.svg),
        project,
      )
      downloadBlob(zipFileName(projection.shape), new Blob([bytes], { type: 'application/zip' }))
    } finally {
      setZipping(false)
    }
  }

  return (
    <aside className="flex min-h-0 flex-col border-l">
      <header className="flex items-center justify-between px-4 py-2">
        <div>
          <h2 className="text-sm font-medium">Faces</h2>
          {projection && projection.projectMs > 0 && (
            <p className="text-xs text-muted-foreground">
              projected in {Math.round(projection.projectMs)} ms
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!projection || computing || zipping}
          onClick={() => void exportZip()}
        >
          {zipping ? <LoaderCircle className="animate-spin" /> : <Download />} ZIP
        </Button>
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {projection ? (
          <ul className="grid grid-cols-2 gap-2 p-4">
            {projection.faces.map((face, i) => (
              <li key={i}>
                <Button
                  variant="outline"
                  aria-pressed={i === selected}
                  onClick={() => selectFace(i)}
                  className="relative aspect-square h-auto w-full bg-white p-1 hover:bg-white aria-pressed:ring-2 aria-pressed:ring-primary"
                >
                  <img src={face.url} alt="" className="h-full w-full object-contain" />
                  <span className="absolute top-1 left-1.5 font-mono text-[10px] text-muted-foreground">
                    {String(i).padStart(2, '0')}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex justify-center p-8">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </ScrollArea>
    </aside>
  )
}
