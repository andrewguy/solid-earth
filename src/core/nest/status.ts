import type { ProjectSettings } from '../settings'

import { currentLayout } from './key'

/**
 * What the UI and the ZIP export should do with the saved sheet layout (plan §13.1 Trigger and
 * Output, §13.4 step 10).
 */

export const STALE_LAYOUT_WARNING =
  'The sheet layout is out of date (the shape, size, material, joints or sheet settings ' +
  'changed). Nest again to update it.'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Warnings about the saved layout: stale, or panels that don't fit the sheet. */
export function nestWarnings(s: ProjectSettings): string[] {
  if (!s.nestLayout) return []
  const layout = currentLayout(s)
  if (!layout) return [STALE_LAYOUT_WARNING]
  const n = layout.unplaced.length
  if (n === 0) return []
  const faces = layout.unplaced.map((f) => String(f).padStart(2, '0')).join(', ')
  return [
    `${n} ${plural(n, 'panel does', 'panels do')} not fit the ` +
      `${s.nest.sheetWidthMm} × ${s.nest.sheetHeightMm} mm sheet at any allowed rotation and ` +
      `${plural(n, 'is', 'are')} left off the sheets (${plural(n, 'face', 'faces')} ${faces}). ` +
      'Use a larger sheet, a smaller edge length, or allow more rotations.',
  ]
}

export interface ZipSheets {
  /** Sheet SVGs to add to the ZIP; empty unless the layout is current and fully rendered. */
  readonly sheets: readonly string[]
  /** Why sheets were left out, when there is a saved layout but its sheets can't be included. */
  readonly warning: string | null
}

/**
 * The sheets to put in the ZIP. `sheetSvgs` is what the projector last rendered (null if none);
 * it only counts when it has one SVG per sheet of the current layout, so a render still in
 * flight never exports the previous layout's sheets.
 */
export function sheetsForZip(s: ProjectSettings, sheetSvgs: readonly string[] | null): ZipSheets {
  if (!s.nestLayout) return { sheets: [], warning: null }
  const layout = currentLayout(s)
  if (!layout) {
    return { sheets: [], warning: `Sheets were left out of the ZIP. ${STALE_LAYOUT_WARNING}` }
  }
  if (layout.sheetCount === 0) return { sheets: [], warning: null }
  if (!sheetSvgs || sheetSvgs.length !== layout.sheetCount) {
    return { sheets: [], warning: 'Sheets were left out of the ZIP: they are still rendering.' }
  }
  return { sheets: sheetSvgs, warning: null }
}
