import { Download } from 'lucide-react'

import { Button } from '@/ui/components/ui/button'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { Separator } from '@/ui/components/ui/separator'

// Placeholder grid: 20 icosahedron faces. Real previews arrive in milestone 4.
const FACE_COUNT = 20

export function FacesPanel() {
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
            <li
              key={i}
              className="flex aspect-square items-center justify-center rounded-md border bg-muted/40 font-mono text-xs text-muted-foreground"
            >
              {String(i).padStart(2, '0')}
            </li>
          ))}
        </ul>
      </ScrollArea>
    </aside>
  )
}
