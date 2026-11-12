/**
 * Sheet nesting settings and results (plan §13). Lengths in mm, angles in degrees.
 */

/**
 * Which rotations the nester may use. `free` steps through `rotationStepDeg` from each face's own
 * frame; the others are measured from the panel's north-up export orientation (plan §13.1), so
 * `none` places panels exactly as the face previews show them.
 */
export const ROTATION_MODES = ['free', '90', '180', 'none'] as const
export type RotationMode = (typeof ROTATION_MODES)[number]

/** Rotation steps offered in free mode; each divides 360. */
export const ROTATION_STEPS = [1, 2, 5, 10, 15, 30, 45, 90] as const

export interface SheetPreset {
  readonly id: string
  readonly label: string
  readonly widthMm: number
  readonly heightMm: number
}

/** Common sheet stock and laser bed sizes, landscape (plan §13.3). */
export const SHEET_PRESETS: readonly SheetPreset[] = [
  { id: 'a4', label: 'A4', widthMm: 297, heightMm: 210 },
  { id: 'a3', label: 'A3', widthMm: 420, heightMm: 297 },
  { id: '12x12in', label: '12 × 12 in', widthMm: 305, heightMm: 305 },
  { id: '12x24in', label: '12 × 24 in', widthMm: 610, heightMm: 305 },
  { id: '300x200', label: '300 × 200 (K40)', widthMm: 300, heightMm: 200 },
  { id: '400x400', label: '400 × 400 (diode)', widthMm: 400, heightMm: 400 },
  { id: 'glowforge', label: '495 × 279 (Glowforge)', widthMm: 495, heightMm: 279 },
  { id: '600x400', label: '600 × 400', widthMm: 600, heightMm: 400 },
  { id: '900x600', label: '900 × 600', widthMm: 900, heightMm: 600 },
  { id: '1200x600', label: '1200 × 600', widthMm: 1200, heightMm: 600 },
]

export const CUSTOM_SHEET = 'custom'

export const sheetPreset = (id: string): SheetPreset | undefined =>
  SHEET_PRESETS.find((p) => p.id === id)

/** True if the sheet size is the preset's, in either orientation. */
export const matchesPreset = (p: SheetPreset, widthMm: number, heightMm: number) =>
  (p.widthMm === widthMm && p.heightMm === heightMm) ||
  (p.widthMm === heightMm && p.heightMm === widthMm)

export interface NestSettings {
  /** A `SHEET_PRESETS` id, or `custom`. The size fields are authoritative. */
  readonly sheetPreset: string
  readonly sheetWidthMm: number
  readonly sheetHeightMm: number
  /** Minimum gap between cut paths. */
  readonly gapMm: number
  /** Minimum distance from any cut path to the sheet edge. */
  readonly marginMm: number
  readonly rotationMode: RotationMode
  /** Used in free mode only. */
  readonly rotationStepDeg: number
  /** Optimiser budget (plan §13.1 Budget). */
  readonly generations: number
  readonly population: number
  /** PRNG seed: the same input and seed give the same layout. */
  readonly seed: number
  /**
   * Draw the sheet boundary on LightBurn's T1 tool layer. Off by default: LightBurn only imports
   * onto tool layers with "Allow importing to Tool Layers" enabled, and otherwise puts the
   * outline on layer 05, which is output (plan §13.6).
   */
  readonly sheetOutline: boolean
}

export const DEFAULT_NEST_SETTINGS: NestSettings = {
  sheetPreset: '600x400',
  sheetWidthMm: 600,
  sheetHeightMm: 400,
  gapMm: 2,
  marginMm: 5,
  rotationMode: 'free',
  rotationStepDeg: 15,
  generations: 20,
  population: 10,
  seed: 1,
  sheetOutline: false,
}

/**
 * Where one panel goes: a rigid transform from the panel's reference frame (the face frame in
 * free mode, the north-up export frame otherwise) to the sheet, in mm, y up from the sheet's
 * bottom-left corner. Sheet point = R(angleDeg) · p + (x, y).
 */
export interface NestPlacement {
  readonly face: number
  readonly sheet: number
  readonly x: number
  readonly y: number
  readonly angleDeg: number
}

/** A nesting result, saved with the project (plan §13.1 Trigger). */
export interface NestLayout {
  /** `nestInputKey` of the settings it was made for; a mismatch means the layout is stale. */
  readonly inputKey: string
  readonly sheetCount: number
  /** One per placed face, each face at most once. */
  readonly placements: readonly NestPlacement[]
  /** Faces that fit on the sheet at no allowed rotation. */
  readonly unplaced: readonly number[]
}
