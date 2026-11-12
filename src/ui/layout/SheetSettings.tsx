import { ArrowLeftRight } from 'lucide-react'

import {
  CUSTOM_SHEET,
  ROTATION_MODES,
  ROTATION_STEPS,
  type RotationMode,
  SHEET_PRESETS,
  matchesPreset,
  sheetPreset,
} from '@/core/nest/types'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select'
import { Switch } from '@/ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { NumberField } from '@/ui/layout/fields'
import { useAppStore } from '@/ui/store'

const ROTATION_LABELS: Record<RotationMode, string> = {
  free: 'Free',
  '90': '90° steps',
  '180': '180° only',
  none: 'None (north-up)',
}

const ROTATION_HELP: Record<RotationMode, string> = {
  free: 'Panels may turn to any multiple of the step. Best material use.',
  '90': 'Panels stay north-up or turn by 90°, so the grain runs one of two ways across the map.',
  '180': 'Panels stay north-up or upside down, keeping the grain parallel across the map.',
  none: 'Panels sit exactly as in the face previews, north-up, with the grain all one way.',
}

const isRotationMode = (v: string): v is RotationMode =>
  (ROTATION_MODES as readonly string[]).includes(v)

/** Sheet size, spacing, rotation and optimiser budget for nesting (plan §13.4 step 11). */
export function SheetSettings() {
  const nest = useAppStore((s) => s.nest)
  const setNest = useAppStore((s) => s.setNest)

  // Typing a size keeps the preset only while the size still matches it (in either orientation).
  const setSize = (sheetWidthMm: number, sheetHeightMm: number) => {
    const p = sheetPreset(nest.sheetPreset)
    setNest({
      sheetWidthMm,
      sheetHeightMm,
      sheetPreset: p && matchesPreset(p, sheetWidthMm, sheetHeightMm) ? p.id : CUSTOM_SHEET,
    })
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <Select
          value={nest.sheetPreset}
          onValueChange={(id) => {
            const p = sheetPreset(id)
            if (p) setNest({ sheetPreset: id, sheetWidthMm: p.widthMm, sheetHeightMm: p.heightMm })
            else setNest({ sheetPreset: CUSTOM_SHEET })
          }}
        >
          <SelectTrigger className="w-full" aria-label="Sheet size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHEET_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_SHEET}>Custom</SelectItem>
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Swap width and height"
              onClick={() => setSize(nest.sheetHeightMm, nest.sheetWidthMm)}
            >
              <ArrowLeftRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Swap width and height</TooltipContent>
        </Tooltip>
      </div>
      <NumberField
        id="sheet-width"
        label="Width"
        unit="mm"
        value={nest.sheetWidthMm}
        onCommit={(w) => setSize(w, nest.sheetHeightMm)}
        step={1}
        min={10}
        accept={(v) => v >= 10 && v <= 5000}
      />
      <NumberField
        id="sheet-height"
        label="Height"
        unit="mm"
        value={nest.sheetHeightMm}
        onCommit={(h) => setSize(nest.sheetWidthMm, h)}
        step={1}
        min={10}
        accept={(v) => v >= 10 && v <= 5000}
      />
      <NumberField
        id="sheet-gap"
        label="Gap between panels"
        unit="mm"
        value={nest.gapMm}
        onCommit={(gapMm) => setNest({ gapMm })}
        step={0.5}
        accept={(v) => v >= 0 && v <= 50}
      />
      <NumberField
        id="sheet-margin"
        label="Sheet margin"
        unit="mm"
        value={nest.marginMm}
        onCommit={(marginMm) => setNest({ marginMm })}
        step={0.5}
        accept={(v) => v >= 0 && v <= 100}
      />
      <div className="grid grid-cols-[1fr_10rem] items-center gap-2">
        <Label htmlFor="sheet-rotation">Panel rotation</Label>
        <Select
          value={nest.rotationMode}
          onValueChange={(v) => {
            if (isRotationMode(v)) setNest({ rotationMode: v })
          }}
        >
          <SelectTrigger id="sheet-rotation" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROTATION_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {ROTATION_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {nest.rotationMode === 'free' && (
        <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
          <Label htmlFor="sheet-step">Rotation step</Label>
          <Select
            value={String(nest.rotationStepDeg)}
            onValueChange={(v) => setNest({ rotationStepDeg: Number(v) })}
          >
            <SelectTrigger id="sheet-step" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROTATION_STEPS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d}°
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{ROTATION_HELP[nest.rotationMode]}</p>
      <NumberField
        id="sheet-generations"
        label="Optimiser generations"
        unit=""
        value={nest.generations}
        onCommit={(generations) => setNest({ generations })}
        step={1}
        min={1}
        accept={(v) => Number.isInteger(v) && v >= 1 && v <= 100000}
      />
      <p className="text-xs text-muted-foreground">
        More generations can find a tighter layout but take longer. Gap and margin are measured on
        the cut path, after joints and kerf.
      </p>
      <div className="flex items-center justify-between">
        <Label htmlFor="sheet-outline">Sheet outline (T1 tool layer)</Label>
        <Switch
          id="sheet-outline"
          checked={nest.sheetOutline}
          onCheckedChange={(sheetOutline) => setNest({ sheetOutline })}
        />
      </div>
      {nest.sheetOutline && (
        <p className="text-xs text-muted-foreground">
          Drawn in LightBurn’s T1 colour, which is never cut. Turn on{' '}
          <span className="font-medium">Allow importing to Tool Layers</span> in LightBurn’s
          settings first: otherwise the outline lands on layer 05, which <em>is</em> output.
        </p>
      )}
    </>
  )
}
