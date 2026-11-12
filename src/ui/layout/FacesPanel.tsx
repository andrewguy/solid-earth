import { Download, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { serializeProject } from '@/core/export/project-file'
import { buildFacesZip, zipFileName } from '@/core/export/zip'
import { sheetsForZip } from '@/core/nest/status'
import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { Separator } from '@/ui/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs'
import { downloadBlob } from '@/ui/download'
import { SheetsPanel } from '@/ui/layout/SheetsPanel'
import { selectSettings, useAppStore } from '@/ui/store'

function FaceGrid() {
  const projection = useAppStore((s) => s.projection)
  const selected = useAppStore((s) => s.selectedFace)
  const enlargeFace = useAppStore((s) => s.enlargeFace)
  const dragging = useAppStore((s) => s.dragging)
  if (!projection) {
    return (
      <div className="flex justify-center p-8">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return (
    <ul className={`grid grid-cols-2 gap-2 p-4 transition-opacity ${dragging ? 'opacity-50' : ''}`}>
      {projection.faces.map((face, i) => (
        <li key={i}>
          <Button
            variant="outline"
            aria-pressed={i === selected}
            onClick={() => enlargeFace(i)}
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
  )
}

/** Output panel: face previews, sheet layouts (plan §13), and the ZIP export. */
export function FacesPanel() {
  const projection = useAppStore((s) => s.projection)
  const computing = useAppStore((s) => s.computing)
  const [zipping, setZipping] = useState(false)

  async function exportZip() {
    if (!projection) return
    setZipping(true)
    try {
      const settings = selectSettings(useAppStore.getState())
      const { sheets, warning } = sheetsForZip(
        settings,
        projection.sheets.map((s) => s.svg),
      )
      const bytes = await buildFacesZip(
        projection.shape,
        projection.faces.map((f) => f.svg),
        serializeProject(settings),
        sheets,
      )
      downloadBlob(zipFileName(projection.shape), new Blob([bytes], { type: 'application/zip' }))
      if (warning) toast.warning('ZIP saved without sheets', { description: warning })
    } finally {
      setZipping(false)
    }
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l">
      <Tabs defaultValue="faces" className="min-h-0 flex-1 gap-0">
        <header className="flex items-center justify-between gap-2 px-4 py-2">
          <TabsList>
            <TabsTrigger value="faces">Faces</TabsTrigger>
            <TabsTrigger value="sheets">Sheets</TabsTrigger>
          </TabsList>
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
        <TabsContent value="faces" className="min-h-0">
          <ScrollArea className="h-full">
            {projection && projection.projectMs > 0 && (
              <p className="px-4 pt-3 text-xs text-muted-foreground">
                projected in {Math.round(projection.projectMs)} ms
              </p>
            )}
            <FaceGrid />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="sheets" className="min-h-0">
          <ScrollArea className="h-full">
            <SheetsPanel />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
