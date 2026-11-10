import { Download } from 'lucide-react'
import { useMemo } from 'react'

import { faceFileName } from '@/core/export/zip'
import { faceEdges, vGap } from '@/core/panel'
import { buildFrames } from '@/core/polyhedron/faces'
import { longestEdge } from '@/core/pipeline'
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
  const def = useAppStore((s) => s.polyhedron.def)
  const edgeLengthMm = useAppStore((s) => s.edgeLengthMm)
  const thicknessMm = useAppStore((s) => s.thicknessMm)
  const frames = useMemo(() => buildFrames(def), [def])
  const mmPerUnit = edgeLengthMm / longestEdge(frames)
  const edges = index === null ? [] : faceEdges(frames, index)
  const face = index === null ? undefined : projection?.faces[index]
  const filename = index === null ? '' : faceFileName(projection?.shape ?? 'shape', index)

  return (
    <Dialog open={index !== null} onOpenChange={(open) => !open && enlargeFace(null)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{filename}</DialogTitle>
          <DialogDescription>
            Exactly the exported file, at real size in mm, oriented north-up.
          </DialogDescription>
        </DialogHeader>
        {face && (
          <img
            src={face.url}
            alt={`Face ${index} artwork`}
            className="max-h-[70vh] w-full rounded-md border bg-white object-contain"
          />
        )}
        {edges.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="font-normal">Joins face</th>
                <th className="font-normal">Edge length</th>
                <th className="font-normal">Dihedral</th>
                <th className="font-normal">Inner V-gap</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {edges.map((e) => {
                const gap = vGap((e.dihedralDeg * Math.PI) / 180, thicknessMm)
                return (
                  <tr key={e.k}>
                    <td>{String(e.neighbour).padStart(2, '0')}</td>
                    <td>{(e.length * mmPerUnit).toFixed(2)} mm</td>
                    <td>{e.dihedralDeg.toFixed(2)}°</td>
                    <td>
                      {gap.angleDeg.toFixed(2)}° / {gap.innerGapMm.toFixed(2)} mm
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
