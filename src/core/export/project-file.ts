import {
  DEFAULT_LAYER_STYLES,
  LIGHTBURN_PALETTE,
  type LayerId,
  type LayerMode,
  type LayerStyle,
  SUBJECTS,
} from '../layers'
import {
  CUSTOM_SHEET,
  DEFAULT_NEST_SETTINGS,
  type NestLayout,
  type NestPlacement,
  type NestSettings,
  ROTATION_MODES,
  ROTATION_STEPS,
  matchesPreset,
  sheetPreset,
} from '../nest/types'
import { PolyhedronError, preprocess } from '../polyhedron/preprocess'
import { isPresetId, preset } from '../polyhedron/presets'
import type { PolyhedronDef } from '../polyhedron/types'
import { type Quat, normalizeQuat } from '../quat'
import {
  DEFAULT_SETTINGS,
  FINGER_TIPS,
  GRATICULE_INTERVALS,
  JOINT_KINDS,
  type ProjectSettings,
  RESOLUTIONS,
  type Resolution,
  isBevelAllowance,
  isCraterMinDiameter,
  isStarDiameter,
  isStarHoleMagLimit,
  isStarMagLimit,
} from '../settings'
import type { Vec3 } from '../vec3'

export const PROJECT_SCHEMA_VERSION = 1
const APP = 'solid-earth'

/** Versioned project file (plan §7.3): also the autosave format. */
export interface ProjectFile extends ProjectSettings {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION
  readonly app: typeof APP
}

export function toProjectFile(settings: ProjectSettings): ProjectFile {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, app: APP, ...settings }
}

export function serializeProject(settings: ProjectSettings): string {
  return `${JSON.stringify(toProjectFile(settings), null, 2)}\n`
}

/** A project file that can't be used at all. Messages are shown to the user. */
export class ProjectFileError extends Error {
  override name = 'ProjectFileError'
}

export interface ParsedProject {
  readonly settings: ProjectSettings
  /** Non-fatal problems that were replaced by defaults, for the user to know about. */
  readonly notes: string[]
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const LAYER_MODES: readonly LayerMode[] = ['stroke', 'fill', 'both']

function parseLayerStyles(raw: unknown, notes: string[]): Record<LayerId, LayerStyle> {
  const out = { ...DEFAULT_LAYER_STYLES }
  if (raw === undefined) return out
  if (!isObject(raw)) {
    notes.push('layer settings were unreadable; using defaults')
    return out
  }
  for (const id of Object.keys(DEFAULT_LAYER_STYLES) as LayerId[]) {
    const r = raw[id]
    if (r === undefined) continue
    if (!isObject(r)) {
      notes.push(`layer "${id}" was unreadable; using defaults`)
      continue
    }
    const d = DEFAULT_LAYER_STYLES[id]
    let color = d.color
    if (typeof r.color === 'string') {
      const upper = r.color.toUpperCase()
      if ((LIGHTBURN_PALETTE as readonly string[]).includes(upper)) color = upper
      else
        notes.push(`layer "${d.label}": ${r.color} is not a LightBurn colour; reset to ${d.color}`)
    }
    out[id] = {
      label: d.label, // labels come from the app, not the file
      enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
      color,
      mode: LAYER_MODES.includes(r.mode as LayerMode) ? (r.mode as LayerMode) : d.mode,
      previewWidth:
        isNum(r.previewWidth) && r.previewWidth >= 0.5 && r.previewWidth <= 4
          ? r.previewWidth
          : d.previewWidth,
    }
  }
  return out
}

function parsePolyhedron(
  raw: Json,
  notes: string[],
): { preset: string | null; def: PolyhedronDef } {
  if (typeof raw.preset === 'string' && isPresetId(raw.preset)) {
    return { preset: raw.preset, def: preset(raw.preset) }
  }
  if (raw.polyhedron === undefined) {
    notes.push('no shape in the file; using the icosahedron')
    return { preset: DEFAULT_SETTINGS.preset, def: DEFAULT_SETTINGS.polyhedron }
  }
  const p = raw.polyhedron
  if (!isObject(p) || !Array.isArray(p.vertices) || !Array.isArray(p.faces)) {
    throw new ProjectFileError('the shape in this project is malformed')
  }
  try {
    // Re-validate: the file may have been edited by hand.
    const def = preprocess({
      name: typeof p.name === 'string' ? p.name : 'custom',
      vertices: p.vertices as Vec3[],
      faces: p.faces as number[][],
    })
    return { preset: null, def }
  } catch (err) {
    if (err instanceof PolyhedronError) {
      throw new ProjectFileError(`the shape in this project is invalid: ${err.message}`)
    }
    throw err
  }
}

const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v)

function parseNest(raw: unknown, notes: string[]): NestSettings {
  const d = DEFAULT_NEST_SETTINGS
  if (raw === undefined) return d
  if (!isObject(raw)) {
    notes.push('sheet settings were unreadable; using defaults')
    return d
  }
  const num = (key: keyof NestSettings, ok: (n: number) => boolean) => {
    const fallback = d[key] as number
    const v = raw[key]
    if (v === undefined) return fallback
    if (isNum(v) && ok(v)) return v
    notes.push(`sheet ${key} was invalid; using ${fallback}`)
    return fallback
  }
  const sheetWidthMm = num('sheetWidthMm', (n) => n >= 10 && n <= 5000)
  const sheetHeightMm = num('sheetHeightMm', (n) => n >= 10 && n <= 5000)
  // The size is authoritative; keep the preset id only while it still describes that size.
  const presetId = raw.sheetPreset === undefined ? d.sheetPreset : raw.sheetPreset
  const preset = typeof presetId === 'string' ? sheetPreset(presetId) : undefined
  const rotationMode = (ROTATION_MODES as readonly unknown[]).includes(raw.rotationMode)
    ? (raw.rotationMode as NestSettings['rotationMode'])
    : d.rotationMode
  if (raw.rotationMode !== undefined && rotationMode !== raw.rotationMode) {
    notes.push(`unknown sheet rotation mode ${String(raw.rotationMode)}; using ${d.rotationMode}`)
  }
  return {
    sheetPreset:
      preset && matchesPreset(preset, sheetWidthMm, sheetHeightMm) ? preset.id : CUSTOM_SHEET,
    sheetWidthMm,
    sheetHeightMm,
    gapMm: num('gapMm', (n) => n >= 0 && n <= 50),
    marginMm: num('marginMm', (n) => n >= 0 && n <= 100),
    rotationMode,
    rotationStepDeg: num('rotationStepDeg', (n) =>
      (ROTATION_STEPS as readonly number[]).includes(n),
    ),
    generations: num('generations', (n) => isInt(n) && n >= 1 && n <= 100000),
    population: num('population', (n) => isInt(n) && n >= 2 && n <= 1000),
    seed: num('seed', (n) => isInt(n) && n >= 0 && n <= 0xffffffff),
    sheetOutline: typeof raw.sheetOutline === 'boolean' ? raw.sheetOutline : d.sheetOutline,
  }
}

/**
 * A saved sheet layout, or null if it is missing or doesn't fit the shape. Whether it is stale
 * is decided later, by its input key (`currentLayout`).
 */
function parseLayout(raw: unknown, faceCount: number, notes: string[]): NestLayout | null {
  if (raw === undefined || raw === null) return null
  const invalid = () => {
    notes.push('the saved sheet layout was invalid and has been discarded; nest again')
    return null
  }
  if (!isObject(raw) || typeof raw.inputKey !== 'string') return invalid()
  const { sheetCount, placements, unplaced } = raw
  if (!isInt(sheetCount) || sheetCount < 0 || !Array.isArray(placements)) return invalid()
  if (!Array.isArray(unplaced) || !unplaced.every(isInt)) return invalid()
  const seen = new Set<number>()
  const claim = (face: number) => {
    if (face < 0 || face >= faceCount || seen.has(face)) return false
    seen.add(face)
    return true
  }
  const out: NestPlacement[] = []
  for (const p of placements) {
    if (!isObject(p)) return invalid()
    const { face, sheet, x, y, angleDeg } = p
    if (!isInt(face) || !claim(face)) return invalid()
    if (!isInt(sheet) || sheet < 0 || sheet >= sheetCount) return invalid()
    if (!isNum(x) || !isNum(y) || !isNum(angleDeg)) return invalid()
    out.push({ face, sheet, x, y, angleDeg })
  }
  if (!unplaced.every(claim) || seen.size !== faceCount) return invalid()
  return { inputKey: raw.inputKey, sheetCount, placements: out, unplaced: [...unplaced] }
}

/**
 * Read a project file or autosave (plan §3 Persistence). Tolerant: anything missing or invalid
 * falls back to the default and is reported in `notes`. Throws `ProjectFileError` only when the
 * file is unusable (not JSON, not a project, from a newer version, or an invalid shape).
 */
export function parseProject(text: string): ParsedProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectFileError('not a valid project file (not JSON)')
  }
  if (!isObject(raw) || raw.app !== APP) {
    throw new ProjectFileError('not a Solid Earth project file')
  }
  if (!isNum(raw.schemaVersion) || raw.schemaVersion < 1) {
    throw new ProjectFileError('the project file has no valid schema version')
  }
  if (raw.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new ProjectFileError(
      `this project was saved by a newer version of the app (schema ${raw.schemaVersion}); ` +
        'please update the app',
    )
  }

  const notes: string[] = []
  const d = DEFAULT_SETTINGS
  const num = (key: string, ok: (n: number) => boolean, fallback: number) => {
    const v = raw[key]
    if (v === undefined) return fallback
    if (isNum(v) && ok(v)) return v
    notes.push(`${key} was invalid; using ${fallback}`)
    return fallback
  }

  const { preset: presetId, def } = parsePolyhedron(raw, notes)

  let rotation: Quat = d.rotation
  if (raw.rotation !== undefined) {
    const q = raw.rotation
    if (Array.isArray(q) && q.length === 4 && q.every(isNum) && Math.hypot(...q) > 1e-9) {
      rotation = normalizeQuat(q as unknown as Quat)
    } else {
      notes.push('rotation was invalid; reset')
    }
  }

  const choice = <T extends string>(key: string, options: readonly T[], fallback: T): T => {
    const v = raw[key]
    if (v === undefined) return fallback
    if ((options as readonly unknown[]).includes(v)) return v as T
    notes.push(`unknown ${key} ${String(v)}; using ${fallback}`)
    return fallback
  }

  let resolution: Resolution = d.resolution
  if (raw.resolution !== undefined) {
    if ((RESOLUTIONS as readonly unknown[]).includes(raw.resolution)) {
      resolution = raw.resolution as Resolution
    } else {
      notes.push(`unknown resolution ${String(raw.resolution)}; using ${d.resolution}`)
    }
  }

  const settings: ProjectSettings = {
    preset: presetId,
    polyhedron: def,
    rotation,
    edgeLengthMm: num('edgeLengthMm', (n) => n > 0 && n < 100000, d.edgeLengthMm),
    resolution,
    layerStyles: parseLayerStyles(raw.layerStyles, notes),
    graticuleIntervalDeg: num(
      'graticuleIntervalDeg',
      (n) => (GRATICULE_INTERVALS as readonly number[]).includes(n),
      d.graticuleIntervalDeg,
    ),
    thicknessMm: num('thicknessMm', (n) => n > 0 && n < 1000, d.thicknessMm),
    kerfEnabled: typeof raw.kerfEnabled === 'boolean' ? raw.kerfEnabled : d.kerfEnabled,
    kerfMm: num('kerfMm', (n) => n >= 0 && n < 5, d.kerfMm),
    joint: choice('joint', JOINT_KINDS, d.joint),
    fingerWidthMm: num('fingerWidthMm', (n) => n > 0 && n < 10000, d.fingerWidthMm),
    fingerTip: choice('fingerTip', FINGER_TIPS, d.fingerTip),
    fingerClearanceMm: num('fingerClearanceMm', (n) => n > -1 && n < 1, d.fingerClearanceMm),
    bevelAllowanceMm: num('bevelAllowanceMm', isBevelAllowance, d.bevelAllowanceMm),
    subject: choice('subject', SUBJECTS, d.subject),
    skyFlip: typeof raw.skyFlip === 'boolean' ? raw.skyFlip : d.skyFlip,
    starMagLimit: num('starMagLimit', isStarMagLimit, d.starMagLimit),
    starMinDiameterMm: num('starMinDiameterMm', isStarDiameter, d.starMinDiameterMm),
    starMaxDiameterMm: num('starMaxDiameterMm', isStarDiameter, d.starMaxDiameterMm),
    starHoleMagLimit: num('starHoleMagLimit', isStarHoleMagLimit, d.starHoleMagLimit),
    starHoleMinDiameterMm: num('starHoleMinDiameterMm', isStarDiameter, d.starHoleMinDiameterMm),
    skyGridIntervalDeg: num(
      'skyGridIntervalDeg',
      (n) => (GRATICULE_INTERVALS as readonly number[]).includes(n),
      d.skyGridIntervalDeg,
    ),
    craterMinDiameterKm: num('craterMinDiameterKm', isCraterMinDiameter, d.craterMinDiameterKm),
    moonGridIntervalDeg: num(
      'moonGridIntervalDeg',
      (n) => (GRATICULE_INTERVALS as readonly number[]).includes(n),
      d.moonGridIntervalDeg,
    ),
    nest: parseNest(raw.nest, notes),
    nestLayout: parseLayout(raw.nestLayout, def.faces.length, notes),
  }
  return { settings, notes }
}

/** `<shape>_project.json` */
export const projectFileName = (settings: ProjectSettings) =>
  `${settings.polyhedron.name}_project.json`
