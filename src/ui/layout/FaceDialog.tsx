import { Download } from 'lucide-react'

import { faceFileName } from '@/core/export/zip'
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
import { useAppStore } from '@/ui/store'

/** Enlarged single face with its own SVG download (plan §6.6). */
export function FaceDialog() {
  const index = useAppStore((s) => s.enlargedFace)
  const projection = useAppStore((s) => s.projection)
  const enlargeFace = useAppStore((s) => s.enlargeFace)
  const face = index === null ? undefined : projection?.faces[index]
  const filename = index === null ? '' : faceFileName(projection?.shape ?? 'shape', index)

  return (
    <Dialog open={index !== null} onOpenChange={(open) => !open && enlargeFace(null)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{filename}</DialogTitle>
          <DialogDescription>Exactly the exported file, at real size in mm.</DialogDescription>
        </DialogHeader>
        {face && (
          <img
            src={face.url}
            alt={`Face ${index} artwork`}
            className="max-h-[70vh] w-full rounded-md border bg-white object-contain"
          />
        )}
        <DialogFooter>
          <Button
            disabled={!face}
            onClick={() => face && downloadText(filename, face.svg, 'image/svg+xml')}
          >
            <Download /> Download SVG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
