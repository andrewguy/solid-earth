import { Download } from 'lucide-react'

import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { Separator } from '@/ui/components/ui/separator'
import { FACE_COUNT } from '@/ui/artwork'
import { useAppStore } from '@/ui/store'

// Face picker. Thumbnails and ZIP export arrive in milestone 4.
export function FacesPanel() {
  const selected = useAppStore((s) => s.selectedFace)
  const selectFace = useAppStore((s) => s.selectFace)

  return (
    <aside className="flex min-h-0 flex-col border-l">
      <header className="flex items-center justify-between px-4 py-2">
        <h2 className="text-sm font-medium">Faces</h2>
        <Button size="sm" variant="outline" disabled>
          <Download /> ZIP
        </Button>
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <ul className="grid grid-cols-3 gap-2 p-4">
          {Array.from({ length: FACE_COUNT }, (_, i) => (
            <li key={i}>
              <Button
                variant={i === selected ? 'default' : 'outline'}
                className="aspect-square h-auto w-full font-mono text-xs"
                aria-pressed={i === selected}
                onClick={() => selectFace(i)}
              >
                {String(i).padStart(2, '0')}
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </aside>
  )
}
