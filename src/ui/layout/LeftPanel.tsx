import { RotateCcw, Upload } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import type { LayerId } from '@/core/layers'

import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select'
import { Separator } from '@/ui/components/ui/separator'
import { Switch } from '@/ui/components/ui/switch'
import { useAppStore } from '@/ui/store'

// Edge length and the coastline/border toggles are live; the rest are placeholders until
// their milestones land.

const SHAPES = [
  { id: 'tetrahedron', label: 'Tetrahedron' },
  { id: 'cube', label: 'Cube' },
  { id: 'octahedron', label: 'Octahedron' },
  { id: 'dodecahedron', label: 'Dodecahedron' },
  { id: 'icosahedron', label: 'Icosahedron' },
  { id: 'truncated-icosahedron', label: 'Truncated icosahedron' },
] as const

const LAYERS: readonly { id: LayerId; label: string; available: boolean }[] = [
  { id: 'coastlines', label: 'Coastlines', available: true },
  { id: 'borders', label: 'Country borders', available: true },
  { id: 'rivers', label: 'Rivers', available: false },
  { id: 'lakes', label: 'Lakes', available: false },
  { id: 'land', label: 'Land fill', available: false },
  { id: 'ocean', label: 'Ocean fill', available: false },
  { id: 'graticule', label: 'Graticule', available: false },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

function NumberField({
  id,
  label,
  unit,
  value,
  onCommit,
  step,
}: {
  id: string
  label: string
  unit: string
  value: number
  /** Called with valid positive values as the user types; omit for a placeholder field. */
  onCommit?: (value: number) => void
  step: number
}) {
  // Keep a draft so the field can be cleared or hold partial input while typing.
  const [draft, setDraft] = useState(String(value))
  return (
    <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          value={draft}
          step={step}
          min={0}
          className="pr-9"
          onChange={(e) => {
            setDraft(e.target.value)
            const v = e.target.valueAsNumber
            if (onCommit && Number.isFinite(v) && v > 0) onCommit(v)
          }}
          onBlur={() => setDraft(String(value))}
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  )
}

export function LeftPanel() {
  const edgeLengthMm = useAppStore((s) => s.edgeLengthMm)
  const setEdgeLengthMm = useAppStore((s) => s.setEdgeLengthMm)
  const layerStyles = useAppStore((s) => s.layerStyles)
  const setLayerEnabled = useAppStore((s) => s.setLayerEnabled)
  const [kerfEnabled, setKerfEnabled] = useState(false)

  return (
    <aside className="flex min-h-0 flex-col border-r">
      <header className="px-4 py-3">
        <h1 className="text-sm font-semibold">Polyhedral Map Projector</h1>
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-4">
          <Section title="Shape">
            <Select defaultValue="icosahedron">
              <SelectTrigger className="w-full" aria-label="Polyhedron">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHAPES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="w-full" disabled>
              <Upload /> Import OBJ / JSON
            </Button>
          </Section>

          <Section title="Size & material">
            <NumberField
              id="edge"
              label="Edge length"
              unit="mm"
              value={edgeLengthMm}
              onCommit={setEdgeLengthMm}
              step={1}
            />
            <NumberField id="thickness" label="Thickness" unit="mm" value={3} step={0.1} />
            <div className="flex items-center justify-between">
              <Label htmlFor="kerf-on">Kerf compensation</Label>
              <Switch id="kerf-on" checked={kerfEnabled} onCheckedChange={setKerfEnabled} />
            </div>
            {kerfEnabled && (
              <NumberField id="kerf" label="Kerf" unit="mm" value={0.15} step={0.01} />
            )}
          </Section>

          <Section title="Map data">
            <Select defaultValue="110m">
              <SelectTrigger className="w-full" aria-label="Data resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="110m">1:110m (coarse)</SelectItem>
                <SelectItem value="50m">1:50m (medium)</SelectItem>
                <SelectItem value="10m" disabled>
                  1:10m (fine)
                </SelectItem>
              </SelectContent>
            </Select>
          </Section>

          <Section title="Layers">
            <ul className="space-y-2">
              {LAYERS.map((l) => (
                <li key={l.id} className="flex items-center justify-between">
                  <Label htmlFor={`layer-${l.id}`}>{l.label}</Label>
                  <Switch
                    id={`layer-${l.id}`}
                    disabled={!l.available}
                    checked={l.available && layerStyles[l.id].enabled}
                    onCheckedChange={(on) => setLayerEnabled(l.id, on)}
                  />
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Globe rotation">
            <dl className="grid grid-cols-3 gap-2 text-center text-xs">
              {(['Lon', 'Lat', 'Roll'] as const).map((k) => (
                <div key={k} className="rounded-md border px-2 py-1.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono">0.0°</dd>
                </div>
              ))}
            </dl>
            <Button variant="outline" size="sm" className="w-full" disabled>
              <RotateCcw /> Reset rotation
            </Button>
          </Section>
        </div>
      </ScrollArea>
    </aside>
  )
}
