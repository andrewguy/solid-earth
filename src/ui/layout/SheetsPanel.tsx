import { Download, LayoutGrid, LoaderCircle, X } from 'lucide-react'

import { sheetFileName } from '@/core/export/zip'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { Progress } from '@/ui/components/ui/progress'
import { downloadText } from '@/ui/download'
import { cancelNesting, runNesting } from '@/ui/nesting'
import { selectCurrentLayout, useAppStore } from '@/ui/store'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Nest button, or progress with Cancel while a job runs. */
function NestControls() {
  const nesting = useAppStore((s) => s.nesting)
  const hasLayout = useAppStore((s) => s.nestLayout !== null)
  if (!nesting) {
    return (
      <Button className="w-full" onClick={() => void runNesting()}>
        <LayoutGrid /> {hasLayout ? 'Nest again' : 'Nest panels'}
      </Button>
    )
  }
  const p = nesting.progress
  const percent = p ? (100 * p.generation) / p.generations : 0
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5">
          <LoaderCircle className="size-3.5 animate-spin" />
          {p
            ? `Generation ${p.generation} of ${p.generations} · best ${plural(p.sheetCount, 'sheet', 'sheets')}`
            : 'Preparing panels…'}
        </span>
        <Button size="sm" variant="ghost" onClick={cancelNesting}>
          <X /> Cancel
        </Button>
      </div>
      <Progress value={percent} aria-label="Nesting progress" />
    </div>
  )
}

/** The Sheets tab (plan §13.4 step 11). */
export function SheetsPanel() {
  const projection = useAppStore((s) => s.projection)
  const nest = useAppStore((s) => s.nest)
  const nestLayout = useAppStore((s) => s.nestLayout)
  const enlargeSheet = useAppStore((s) => s.enlargeSheet)
  const layout = useAppStore(selectCurrentLayout)
  const shape = projection?.shape ?? 'shape'
  const sheets = projection?.sheets ?? []
  const rendered = layout !== null && sheets.length === layout.sheetCount

  return (
    <div className="space-y-4 p-4">
      <NestControls />
      {!nestLayout && (
        <p className="text-xs text-muted-foreground">
          Lay every panel out on {nest.sheetWidthMm} × {nest.sheetHeightMm} mm sheets, using as few
          sheets as possible and keeping the leftover in one strip on the right.
        </p>
      )}
      {nestLayout && !layout && (
        <div className="space-y-1.5">
          <Badge variant="secondary">Out of date</Badge>
          <p className="text-xs text-muted-foreground">
            The shape, size, material, joints or sheet settings changed since the last nest. Nest
            again to update the sheets.
          </p>
        </div>
      )}
      {layout && (
        <p className="text-xs text-muted-foreground">
          {plural(layout.placements.length, 'panel', 'panels')} on{' '}
          {plural(layout.sheetCount, 'sheet', 'sheets')} of {nest.sheetWidthMm} ×{' '}
          {nest.sheetHeightMm} mm
          {layout.unplaced.length > 0 &&
            `; ${plural(layout.unplaced.length, 'panel does', 'panels do')} not fit`}
          .
        </p>
      )}
      {layout && !rendered && layout.sheetCount > 0 && (
        <div className="flex justify-center p-4">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {rendered && (
        <ul className="space-y-3">
          {sheets.map((sheet, i) => (
            <li key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Sheet {i + 1}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadText(sheetFileName(shape, i), sheet.svg, 'image/svg+xml')}
                >
                  <Download /> SVG
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() => enlargeSheet(i)}
                className="h-auto w-full bg-white p-1 hover:bg-white"
                style={{ aspectRatio: `${nest.sheetWidthMm} / ${nest.sheetHeightMm}` }}
                aria-label={`Enlarge sheet ${i + 1}`}
              >
                <img src={sheet.url} alt="" className="h-full w-full object-contain" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
