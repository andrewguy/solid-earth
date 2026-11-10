import { RotateCcw, Upload } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { rotationReadout } from '@/core/geo/rotation'
import { dihedralGroups } from '@/core/panel'
import { buildFrames } from '@/core/polyhedron/faces'
import { importPolyhedron } from '@/core/polyhedron/import'
import { PolyhedronError } from '@/core/polyhedron/preprocess'
import { PRESETS, PRESET_IDS, isPresetId, preset } from '@/core/polyhedron/presets'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import { distance, length } from '@/core/vec3'
import { RESOLUTIONS, type Resolution } from '@/core/settings'

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
import { LayerTable } from '@/ui/layout/LayerTable'
import { ProjectToolbar } from '@/ui/layout/ProjectToolbar'
import { Warnings } from '@/ui/layout/Warnings'
import { useAppStore } from '@/ui/store'

// Edge length, data resolution and the coastline/border toggles are live; the rest are placeholders until
// their milestones land.

const CUSTOM = 'custom'

/** Circumsphere diameter in mm when the longest edge is `edgeMm` (plan §3). */
function circumDiameterMm(def: PolyhedronDef, edgeMm: number): number {
  let longest = 0
  for (const f of def.faces)
    f.forEach((a, k) => {
      longest = Math.max(longest, distance(def.vertices[a]!, def.vertices[f[(k + 1) % f.length]!]!))
    })
  const radius = Math.max(...def.vertices.map(length))
  return (2 * radius * edgeMm) / longest
}

/** Dihedral angles and butt-joint V-gaps (plan §6.3). */
function PanelInfo() {
  const def = useAppStore((s) => s.polyhedron.def)
  const thicknessMm = useAppStore((s) => s.thicknessMm)
  const groups = useMemo(() => dihedralGroups(buildFrames(def), thicknessMm), [def, thicknessMm])
  return (
    <>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="font-normal">Edges</th>
            <th className="font-normal">Dihedral</th>
            <th className="font-normal">V-gap</th>
            <th className="text-right font-normal">Inner gap</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {groups.map((g) => (
            <tr key={g.dihedralDeg.toFixed(2)}>
              <td>{g.edgeCount}</td>
              <td>{g.dihedralDeg.toFixed(2)}°</td>
              <td>{g.vGapDeg.toFixed(2)}°</td>
              <td className="text-right">{g.innerGapMm.toFixed(2)} mm</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Butt joints: panels are cut square at the true face size, so outer faces meet exactly and a
        V opens on the inside ({thicknessMm} mm material). Fill it with a glue or epoxy fillet.
      </p>
    </>
  )
}

function RotationReadout() {
  const rotation = useAppStore((s) => s.rotation)
  const resetRotation = useAppStore((s) => s.resetRotation)
  const r = rotationReadout(rotation)
  const cells = [
    ['Lon', r.lon],
    ['Lat', r.lat],
    ['Roll', r.roll],
  ] as const
  return (
    <>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        {cells.map(([k, v]) => (
          <div key={k} className="rounded-md border px-2 py-1.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono">{v.toFixed(1)}°</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        The geographic point at the top of the solid, and the spin about it. Drag the globe in the
        3D view to change.
      </p>
      <Button variant="outline" size="sm" className="w-full" onClick={resetRotation}>
        <RotateCcw /> Reset rotation
      </Button>
    </>
  )
}

function ShapePicker() {
  const polyhedron = useAppStore((s) => s.polyhedron)
  const custom = useAppStore((s) => s.custom)
  const setPreset = useAppStore((s) => s.setPreset)
  const setCustom = useAppStore((s) => s.setCustom)
  const chooseCustom = useAppStore((s) => s.chooseCustom)
  const fileInput = useRef<HTMLInputElement>(null)
  const value = isPresetId(polyhedron.id) ? polyhedron.id : CUSTOM

  async function onFile(file: File) {
    try {
      const def = importPolyhedron(file.name, await file.text())
      setCustom(def)
      toast.success(`Imported ${file.name}`, {
        description: `${def.faces.length} faces, ${def.vertices.length} vertices`,
      })
    } catch (err) {
      const message = err instanceof PolyhedronError ? err.message : String(err)
      toast.error(`Could not import ${file.name}`, { description: message, duration: 10000 })
    }
  }

  return (
    <>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === CUSTOM) chooseCustom()
          else if (isPresetId(v)) setPreset(v)
        }}
      >
        <SelectTrigger className="w-full" aria-label="Polyhedron">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESET_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {PRESETS[id].label} ({preset(id).faces.length})
            </SelectItem>
          ))}
          {custom && (
            <SelectItem value={CUSTOM}>
              Custom: {custom.def.name} ({custom.def.faces.length})
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      <input
        ref={fileInput}
        type="file"
        accept=".obj,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow re-importing the same file
          if (file) void onFile(file)
        }}
      />
      <Button variant="outline" className="w-full" onClick={() => fileInput.current?.click()}>
        <Upload /> Import OBJ / JSON
      </Button>
      <p className="text-xs text-muted-foreground">
        Convex shapes only. Triangulated meshes are merged back into flat faces.
      </p>
    </>
  )
}

const isResolution = (v: string): v is Resolution => (RESOLUTIONS as readonly string[]).includes(v)

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
  const polyhedronDef = useAppStore((s) => s.polyhedron.def)
  const setEdgeLengthMm = useAppStore((s) => s.setEdgeLengthMm)
  const resolution = useAppStore((s) => s.resolution)
  const setResolution = useAppStore((s) => s.setResolution)
  const thicknessMm = useAppStore((s) => s.thicknessMm)
  const setThicknessMm = useAppStore((s) => s.setThicknessMm)
  const kerfEnabled = useAppStore((s) => s.kerfEnabled)
  const setKerfEnabled = useAppStore((s) => s.setKerfEnabled)
  const kerfMm = useAppStore((s) => s.kerfMm)
  const setKerfMm = useAppStore((s) => s.setKerfMm)

  return (
    <aside className="flex min-h-0 flex-col border-r">
      <header className="flex items-center justify-between gap-2 py-2 pr-2 pl-4">
        <h1 className="text-sm font-semibold">Polyhedral Map Projector</h1>
        <ProjectToolbar />
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-4">
          <Warnings />
          <Section title="Shape">
            <ShapePicker />
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
            <p className="text-xs text-muted-foreground">
              Longest edge. Circumsphere diameter:{' '}
              {circumDiameterMm(polyhedronDef, edgeLengthMm).toFixed(1)} mm
            </p>
            <NumberField
              id="thickness"
              label="Thickness"
              unit="mm"
              value={thicknessMm}
              onCommit={setThicknessMm}
              step={0.1}
            />
            <div className="flex items-center justify-between">
              <Label htmlFor="kerf-on">Kerf compensation</Label>
              <Switch id="kerf-on" checked={kerfEnabled} onCheckedChange={setKerfEnabled} />
            </div>
            {kerfEnabled && (
              <NumberField
                id="kerf"
                label="Kerf"
                unit="mm"
                value={kerfMm}
                onCommit={setKerfMm}
                step={0.01}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {kerfEnabled
                ? `Cut path is offset outward by ${(kerfMm / 2).toFixed(3)} mm. Engraving is never offset.`
                : 'Off: use LightBurn’s kerf offset instead, or turn this on to bake it into the SVG.'}
            </p>
          </Section>

          <Section title="Map data">
            <Select
              value={resolution}
              onValueChange={(v) => {
                if (isResolution(v)) setResolution(v)
              }}
            >
              <SelectTrigger className="w-full" aria-label="Data resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="110m">1:110m (coarse)</SelectItem>
                <SelectItem value="50m">1:50m (medium)</SelectItem>
              </SelectContent>
            </Select>
          </Section>

          <Section title="Panel geometry">
            <PanelInfo />
          </Section>

          <Section title="Layers">
            <LayerTable />
          </Section>

          <Section title="Globe rotation">
            <RotationReadout />
          </Section>
        </div>
      </ScrollArea>
    </aside>
  )
}
