import { RotateCcw, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { rotationReadout } from '@/core/geo/rotation'
import { type FingerTip, fingerProfile } from '@/core/joints'
import { bevelTiltDeg, dihedralGroups } from '@/core/panel'
import { buildFrames } from '@/core/polyhedron/faces'
import { importPolyhedron } from '@/core/polyhedron/import'
import { PolyhedronError } from '@/core/polyhedron/preprocess'
import { PRESETS, PRESET_IDS, type PresetFamily, isPresetId } from '@/core/polyhedron/presets'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import { distance, length } from '@/core/vec3'
import {
  FINGER_TIPS,
  JOINT_KINDS,
  type JointKind,
  RESOLUTIONS,
  type Resolution,
  isBevelAllowance,
} from '@/core/settings'

import { Button } from '@/ui/components/ui/button'
import { AboutDialog } from '@/ui/layout/AboutDialog'
import { Label } from '@/ui/components/ui/label'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select'
import { Separator } from '@/ui/components/ui/separator'
import { Switch } from '@/ui/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs'
import { LayerTable } from '@/ui/layout/LayerTable'
import { NumberField, Section } from '@/ui/layout/fields'
import { SheetSettings } from '@/ui/layout/SheetSettings'
import { ProjectToolbar } from '@/ui/layout/ProjectToolbar'
import { SheetWarnings, Warnings } from '@/ui/layout/Warnings'
import { useAppStore } from '@/ui/store'

// Edge length, data resolution and the coastline/border toggles are live; the rest are placeholders until
// their milestones land.

const CUSTOM = 'custom'
const DEG_TO_RAD = Math.PI / 180

const PRESET_FAMILIES: readonly { family: PresetFamily; label: string }[] = [
  { family: 'platonic', label: 'Platonic solids' },
  { family: 'archimedean', label: 'Archimedean solids' },
  { family: 'catalan', label: 'Catalan solids (identical faces)' },
]

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

/**
 * Per dihedral angle: insets and outer V-grooves for butt joints (plan §6.3), finger tip and notch
 * positions (§12), or bevel tilt and back-face width for sanded bevels (§14).
 */
function PanelInfo() {
  const def = useAppStore((s) => s.polyhedron.def)
  const thicknessMm = useAppStore((s) => s.thicknessMm)
  const finger = useAppStore((s) => s.joint === 'finger')
  const bevel = useAppStore((s) => s.joint === 'bevel')
  const fingerTip = useAppStore((s) => s.fingerTip)
  const clearanceMm = useAppStore((s) => s.fingerClearanceMm)
  const groups = useMemo(() => dihedralGroups(buildFrames(def), thicknessMm), [def, thicknessMm])
  const mm = (x: number) => `${x.toFixed(2)} mm`
  return (
    <>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="font-normal">Edges</th>
            <th className="font-normal">Dihedral</th>
            {bevel ? (
              <>
                <th className="text-right font-normal">Tilt</th>
                <th className="text-right font-normal">Back</th>
              </>
            ) : (
              <>
                <th className="font-normal">V</th>
                <th className="text-right font-normal">{finger ? 'Tip' : 'Inset'}</th>
                <th className="text-right font-normal">{finger ? 'Notch' : 'Groove'}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="font-mono">
          {groups.map((g) => {
            const prof = finger
              ? fingerProfile(g.dihedralDeg * DEG_TO_RAD, thicknessMm, fingerTip, clearanceMm)
              : null
            return (
              <tr key={g.dihedralDeg.toFixed(2)}>
                <td>{g.edgeCount}</td>
                <td>{g.dihedralDeg.toFixed(2)}°</td>
                {bevel ? (
                  <>
                    <td className="text-right">
                      {bevelTiltDeg(g.dihedralDeg * DEG_TO_RAD).toFixed(2)}°
                    </td>
                    <td className="text-right">{mm(g.insetMm)}</td>
                  </>
                ) : (
                  <>
                    <td>{g.vGapDeg.toFixed(2)}°</td>
                    <td className="text-right">{mm(prof ? prof.tip : g.insetMm)}</td>
                    <td className="text-right">{mm(prof ? prof.notch : g.grooveMm)}</td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        {bevel ? (
          <>
            Sanded bevels ({thicknessMm} mm material): set the sander to Tilt from square and sand
            each edge until the front just reaches the engraved guide. The bevel then ends Back in
            from the edge on the back face.
          </>
        ) : finger ? (
          <>
            Finger joints ({thicknessMm} mm material): measured inward from the true edge, the
            finger ends at Tip (negative: it sticks out past the edge) and the slots go in to Notch.
            Plain stretches at the corners are butt joints.
          </>
        ) : (
          <>
            Butt joints: panels are cut square, with each edge pulled in by the inset so
            neighbouring panels meet at their inner corners ({thicknessMm} mm material). A V-groove
            of angle V opens on the outside; the map lines up across it, but the groove itself is
            not engraved.
          </>
        )}
      </p>
    </>
  )
}

const isJointKind = (v: string): v is JointKind => (JOINT_KINDS as readonly string[]).includes(v)
const isFingerTip = (v: string): v is FingerTip => (FINGER_TIPS as readonly string[]).includes(v)

/** Joint style and finger settings (plan §12). */
function JointSettings() {
  const joint = useAppStore((s) => s.joint)
  const setJoint = useAppStore((s) => s.setJoint)
  const fingerWidthMm = useAppStore((s) => s.fingerWidthMm)
  const setFingerWidthMm = useAppStore((s) => s.setFingerWidthMm)
  const fingerTip = useAppStore((s) => s.fingerTip)
  const setFingerTip = useAppStore((s) => s.setFingerTip)
  const fingerClearanceMm = useAppStore((s) => s.fingerClearanceMm)
  const setFingerClearanceMm = useAppStore((s) => s.setFingerClearanceMm)
  const bevelAllowanceMm = useAppStore((s) => s.bevelAllowanceMm)
  const setBevelAllowanceMm = useAppStore((s) => s.setBevelAllowanceMm)
  return (
    <>
      <div className="grid grid-cols-[1fr_10rem] items-center gap-2">
        <Label htmlFor="joint">Joints</Label>
        <Select
          value={joint}
          onValueChange={(v) => {
            if (isJointKind(v)) setJoint(v)
          }}
        >
          <SelectTrigger id="joint" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="butt">Butt (square cut)</SelectItem>
            <SelectItem value="finger">Finger joints</SelectItem>
            <SelectItem value="bevel">Bevel (sanded)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {joint === 'bevel' && (
        <>
          <NumberField
            id="bevel-allowance"
            label="Sanding allowance"
            unit="mm"
            value={bevelAllowanceMm}
            onCommit={setBevelAllowanceMm}
            step={0.1}
            accept={isBevelAllowance}
          />
          <p className="text-xs text-muted-foreground">
            Panels are cut this far outside the true edge, which is engraved as a sanding guide.
            Sand each edge to a bevel until the front reaches the guide: outer faces then meet
            exactly, with no groove.
          </p>
        </>
      )}
      {joint === 'finger' && (
        <>
          <NumberField
            id="finger-width"
            label="Finger width"
            unit="mm"
            value={fingerWidthMm}
            onCommit={setFingerWidthMm}
            step={0.5}
          />
          <NumberField
            id="finger-clearance"
            label="Clearance per side"
            unit="mm"
            value={fingerClearanceMm}
            onCommit={setFingerClearanceMm}
            step={0.01}
            min={-0.5}
            accept={(v) => v > -1 && v < 1}
          />
          <div className="grid grid-cols-[1fr_10rem] items-center gap-2">
            <Label htmlFor="finger-tip">Finger tips</Label>
            <Select
              value={fingerTip}
              onValueChange={(v) => {
                if (isFingerTip(v)) setFingerTip(v)
              }}
            >
              <SelectTrigger id="finger-tip" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fill">Fill joint</SelectItem>
                <SelectItem value="flush">Flush</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {fingerTip === 'fill'
              ? 'Fingers fill the joint and stick out slightly past the neighbouring panel: sand them flush for a closed outer surface.'
              : 'Nothing sticks out; small wedge-shaped gaps open at the outer surface beside each finger.'}{' '}
            Clearance narrows fingers and widens slots; use a negative value for a press fit. Edges
            too short for two fingers stay butt joints.
          </p>
        </>
      )}
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
          {PRESET_FAMILIES.map(({ family, label }) => (
            <SelectGroup key={family}>
              <SelectLabel>{label}</SelectLabel>
              {PRESET_IDS.filter((id) => PRESETS[id].family === family).map((id) => (
                <SelectItem key={id} value={id}>
                  {PRESETS[id].label}
                  <span className="text-muted-foreground">{PRESETS[id].faces} faces</span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          {custom && (
            <SelectGroup>
              <SelectLabel>Imported</SelectLabel>
              <SelectItem value={CUSTOM}>
                {custom.def.name}
                <span className="text-muted-foreground">{custom.def.faces.length} faces</span>
              </SelectItem>
            </SelectGroup>
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

type LeftTab = 'shape' | 'map' | 'panels' | 'sheets'

const LEFT_TABS: readonly { value: LeftTab; label: string }[] = [
  { value: 'shape', label: 'Shape' },
  { value: 'map', label: 'Map' },
  { value: 'panels', label: 'Panels' },
  { value: 'sheets', label: 'Sheets' },
]

const isLeftTab = (v: string): v is LeftTab => LEFT_TABS.some((t) => t.value === v)

/** Shape, size and orientation of the globe. */
function ShapeTab() {
  const edgeLengthMm = useAppStore((s) => s.edgeLengthMm)
  const polyhedronDef = useAppStore((s) => s.polyhedron.def)
  const setEdgeLengthMm = useAppStore((s) => s.setEdgeLengthMm)
  return (
    <>
      <Section title="Shape">
        <ShapePicker />
      </Section>

      <Section title="Size">
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
      </Section>

      <Section title="Globe rotation">
        <RotationReadout />
      </Section>
    </>
  )
}

/** Map data and what gets drawn. */
function MapTab() {
  const resolution = useAppStore((s) => s.resolution)
  const setResolution = useAppStore((s) => s.setResolution)
  return (
    <>
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

      <Section title="Layers">
        <LayerTable />
      </Section>
    </>
  )
}

/** Material, kerf and how the panels join. */
function PanelsTab() {
  const thicknessMm = useAppStore((s) => s.thicknessMm)
  const setThicknessMm = useAppStore((s) => s.setThicknessMm)
  const kerfEnabled = useAppStore((s) => s.kerfEnabled)
  const setKerfEnabled = useAppStore((s) => s.setKerfEnabled)
  const kerfMm = useAppStore((s) => s.kerfMm)
  const setKerfMm = useAppStore((s) => s.setKerfMm)
  return (
    <>
      <Section title="Material">
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

      <Section title="Joints">
        <JointSettings />
        <PanelInfo />
      </Section>
    </>
  )
}

/**
 * Settings, grouped into tabs in workflow order: pick a shape, style the map, set up the material
 * and joints, then lay the panels out on sheets. Warnings show whichever tab is open: shape and
 * output warnings above the settings, and the sheet layout warning (which appears as soon as a
 * setting changes) below them, so it doesn't shift the controls being edited.
 */
export function LeftPanel() {
  const [tab, setTab] = useState<LeftTab>('shape')
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r">
      <header className="flex items-center justify-between gap-2 py-2 pr-2 pl-4">
        <div className="flex items-center gap-1">
          <h1 className="text-sm font-semibold">Solid Earth</h1>
          <AboutDialog />
        </div>
        <ProjectToolbar />
      </header>
      <Separator />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (isLeftTab(v)) setTab(v)
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="px-4 py-2">
          <TabsList className="w-full">
            {LEFT_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-4">
            <Warnings />
            <TabsContent value="shape" className="space-y-6">
              <ShapeTab />
            </TabsContent>
            <TabsContent value="map" className="space-y-6">
              <MapTab />
            </TabsContent>
            <TabsContent value="panels" className="space-y-6">
              <PanelsTab />
            </TabsContent>
            <TabsContent value="sheets" className="space-y-6">
              <Section title="Sheets">
                <SheetSettings />
              </Section>
            </TabsContent>
            <SheetWarnings />
          </div>
        </ScrollArea>
      </Tabs>
    </aside>
  )
}
