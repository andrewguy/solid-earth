import { Download } from 'lucide-react'

import { sheetFileName } from '@/core/export/zip'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { downloadText } from '@/ui/download'
import { selectCurrentLayout, useAppStore } from '@/ui/store'

/** One sheet enlarged, with the faces on it and its own SVG download (plan §13.4 step 11). */
export function SheetDialog() {
  const index = useAppStore((s) => s.enlargedSheet)
  const enlargeSheet = useAppStore((s) => s.enlargeSheet)
  const projection = useAppStore((s) => s.projection)
  const layout = useAppStore(selectCurrentLayout)
  const nest = useAppStore((s) => s.nest)
  const sheet = index === null ? undefined : projection?.sheets[index]
  const filename = index === null ? '' : sheetFileName(projection?.shape ?? 'shape', index)
  const faces =
    index === null || !layout
      ? []
      : layout.placements
          .filter((p) => p.sheet === index)
          .map((p) => String(p.face).padStart(2, '0'))

  return (
    <Dialog open={index !== null && !!sheet} onOpenChange={(open) => !open && enlargeSheet(null)}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{filename}</DialogTitle>
          <DialogDescription>
            Exactly the exported file: a {nest.sheetWidthMm} × {nest.sheetHeightMm} mm sheet with
            faces {faces.join(', ')}.
          </DialogDescription>
        </DialogHeader>
        {sheet && (
          <img
            src={sheet.url}
            alt={`Sheet ${(index ?? 0) + 1} layout`}
            className="max-h-[70vh] w-full rounded-md border bg-white object-contain"
          />
        )}
        <DialogFooter>
          <Button
            disabled={!sheet}
            onClick={() => sheet && downloadText(filename, sheet.svg, 'image/svg+xml')}
          >
            <Download /> Download SVG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
