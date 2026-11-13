import { Check } from 'lucide-react'

import {
  LIGHTBURN_PALETTE,
  type LayerId,
  type LayerMode,
  type Subject,
  isFillLayer,
  lightBurnIndex,
} from '@/core/layers'
import { GRATICULE_INTERVALS, isStarDiameter, isStarHoleMagLimit } from '@/core/settings'
import { Button } from '@/ui/components/ui/button'
import { Label } from '@/ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select'
import { Slider } from '@/ui/components/ui/slider'
import { Switch } from '@/ui/components/ui/switch'
import { NumberField } from '@/ui/layout/fields'
import { useAppStore } from '@/ui/store'

/**
 * Row order follows plan §6.4 for the Earth and §15.2 for the sky; the sanding guide (plan §14)
 * only shows in bevel mode.
 */
const ROWS: Readonly<Record<Subject, readonly LayerId[]>> = {
  earth: ['cut', 'guide', 'coastlines', 'borders', 'rivers', 'lakes', 'land', 'ocean', 'graticule'],
  sky: ['cut', 'guide', 'starHoles', 'stars', 'constellations', 'milkyWay', 'ecliptic', 'skyGrid'],
}

/** Fill-layer modes, named for what each layer strokes. */
const MODE_LABELS: Partial<Record<LayerId, Readonly<Record<LayerMode, string>>>> = {
  stars: { fill: 'Dots', stroke: 'Rings', both: 'Dots + rings' },
  milkyWay: { fill: 'Fill', stroke: 'Outline', both: 'Fill + outline' },
}
const DEFAULT_MODE_LABELS: Readonly<Record<LayerMode, string>> = {
  fill: 'Fill',
  stroke: 'Shore line',
  both: 'Fill + line',
}
const MODES: readonly LayerMode[] = ['fill', 'stroke', 'both']

const isMode = (v: string): v is LayerMode => (MODES as readonly string[]).includes(v)

/** Interval picker for a grid layer; the sky grid also shows right ascension in hours. */
function GridInterval({
  value,
  onChange,
  hours = false,
}: {
  value: number
  onChange: (deg: number) => void
  hours?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">Interval</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger size="sm" className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GRATICULE_INTERVALS.map((d) => (
            <SelectItem key={d} value={String(d)}>
              {d}°{hours && d % 15 === 0 ? ` (${d / 15} h)` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Which stars are cut through, and the smallest hole (plan §15.2). */
function HoleSettings() {
  const holeMag = useAppStore((s) => s.starHoleMagLimit)
  const setHoleMag = useAppStore((s) => s.setStarHoleMagLimit)
  const holeMin = useAppStore((s) => s.starHoleMinDiameterMm)
  const setDiameters = useAppStore((s) => s.setStarDiametersMm)
  return (
    <div className="space-y-2">
      <NumberField
        id="hole-mag"
        label="Cut stars to mag"
        unit=""
        value={holeMag}
        onCommit={setHoleMag}
        step={0.5}
        min={-2}
        accept={isStarHoleMagLimit}
      />
      <NumberField
        id="hole-min"
        label="Smallest hole"
        unit="mm"
        value={holeMin}
        onCommit={(holeMin) => setDiameters({ holeMin })}
        step={0.1}
        accept={isStarDiameter}
      />
      <p className="text-[11px] text-muted-foreground">
        Stars this bright or brighter are cut through for a lamp; fainter ones are engraved. Holes
        on an edge notch both panels. Cut this layer before the outline.
      </p>
    </div>
  )
}

/** LightBurn palette swatches plus per-layer preview settings (plan §3 UI components). */
function LayerSettings({ id }: { id: LayerId }) {
  const style = useAppStore((s) => s.layerStyles[id])
  const setLayerStyle = useAppStore((s) => s.setLayerStyle)
  const graticuleDeg = useAppStore((s) => s.graticuleIntervalDeg)
  const setGraticuleDeg = useAppStore((s) => s.setGraticuleIntervalDeg)
  const skyGridDeg = useAppStore((s) => s.skyGridIntervalDeg)
  const setSkyGridDeg = useAppStore((s) => s.setSkyGridIntervalDeg)
  const index = lightBurnIndex(style.color)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-14 gap-1.5 px-1.5 font-mono text-[11px]"
          aria-label={`${style.label} colour and settings`}
        >
          <span
            className="size-3.5 shrink-0 rounded-sm border"
            style={{ background: style.color }}
          />
          {index ?? '??'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="end">
        <div className="space-y-1.5">
          <p className="text-xs font-medium">LightBurn layer colour</p>
          <div className="grid grid-cols-10 gap-1">
            {LIGHTBURN_PALETTE.map((color, i) => (
              <Button
                key={color}
                variant="outline"
                size="icon"
                title={`${String(i).padStart(2, '0')}  ${color}`}
                aria-label={`LightBurn layer ${String(i).padStart(2, '0')}`}
                aria-pressed={style.color === color}
                className="size-5 rounded-sm p-0"
                style={{ background: color }}
                onClick={() => setLayerStyle(id, { color })}
              >
                {style.color === color && (
                  <Check className="size-3 text-white mix-blend-difference" />
                )}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            LightBurn assigns layers by exact colour:{' '}
            {index ? `layer ${index}` : 'not a palette colour'}.
          </p>
        </div>
        {id !== 'cut' && id !== 'guide' && id !== 'starHoles' && (
          <div className="space-y-2">
            <Label className="text-xs">Preview line width ({style.previewWidth.toFixed(1)}×)</Label>
            <Slider
              min={0.5}
              max={4}
              step={0.5}
              value={[style.previewWidth]}
              onValueChange={([v]) => v !== undefined && setLayerStyle(id, { previewWidth: v })}
            />
            <p className="text-[11px] text-muted-foreground">On-screen only; exports use 0.1 mm.</p>
          </div>
        )}
        {id === 'graticule' && <GridInterval value={graticuleDeg} onChange={setGraticuleDeg} />}
        {id === 'skyGrid' && <GridInterval value={skyGridDeg} onChange={setSkyGridDeg} hours />}
        {id === 'starHoles' && <HoleSettings />}
      </PopoverContent>
    </Popover>
  )
}

function LayerRow({ id }: { id: LayerId }) {
  const style = useAppStore((s) => s.layerStyles[id])
  const setLayerStyle = useAppStore((s) => s.setLayerStyle)
  return (
    <li className="flex h-8 items-center gap-2">
      <Switch
        id={`layer-${id}`}
        checked={style.enabled}
        onCheckedChange={(enabled) => setLayerStyle(id, { enabled })}
      />
      <Label htmlFor={`layer-${id}`} className="min-w-0 flex-1 truncate text-sm">
        {style.label}
      </Label>
      {isFillLayer(id) && (
        <Select
          value={style.mode}
          onValueChange={(v) => isMode(v) && setLayerStyle(id, { mode: v })}
        >
          <SelectTrigger
            size="sm"
            className="h-7 w-[6.5rem] text-xs"
            aria-label={`${style.label} mode`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {(MODE_LABELS[id] ?? DEFAULT_MODE_LABELS)[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <LayerSettings id={id} />
    </li>
  )
}

/** Layer table (plan §6.4): enable, mode, LightBurn colour, preview width. */
export function LayerTable() {
  const bevel = useAppStore((s) => s.joint === 'bevel')
  const subject = useAppStore((s) => s.subject)
  return (
    <>
      <ul className="space-y-1">
        {ROWS[subject]
          .filter((id) => bevel || id !== 'guide')
          .map((id) => (
            <LayerRow key={id} id={id} />
          ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {subject === 'earth'
          ? 'Fills: shore lines follow coasts and lake edges, never the panel edges.'
          : 'Stars are sized by brightness. Star holes and the Milky Way are off by default.'}
      </p>
    </>
  )
}
