import { Download } from 'lucide-react'

import { Button } from '@/ui/components/ui/button'
import { faceFileName, useFaceSvg } from '@/ui/artwork'
import { downloadText } from '@/ui/download'
import { useAppStore } from '@/ui/store'

// Milestone 3: the selected face's exported SVG, shown as an image so the preview is exactly
// the file. The 3D preview replaces this in milestone 6.
export function CentrePanel() {
  const face = useAppStore((s) => s.selectedFace)
  const svg = useFaceSvg(face)
  const filename = faceFileName(face)
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  return (
    <main className="flex min-h-0 flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2">
        <h2 className="font-mono text-sm">{filename}</h2>
        <Button size="sm" onClick={() => downloadText(filename, svg, 'image/svg+xml')}>
          <Download /> Download SVG
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <img
          src={src}
          alt={`Face ${face} artwork`}
          className="h-full w-full rounded-md bg-white object-contain shadow-sm"
        />
      </div>
    </main>
  )
}
