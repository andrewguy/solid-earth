import type { ProjectSettings } from '../settings'

import type { NestLayout } from './types'

/** Rounded so values renormalised on load (rotation, re-preprocessed shapes) keep their key. */
const r9 = (x: number) => Math.round(x * 1e9) / 1e9

/** cyrb53: a fast, well-mixed 53-bit string hash. Not cryptographic; collisions are harmless. */
function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/**
 * A stable key for everything a sheet layout depends on (plan §13.1 Trigger): the panel outlines
 * (shape, size, thickness, effective kerf and joint) and the sheet (size, gap, margin, rotation
 * mode and step). In the restricted rotation modes the globe rotation is included too, because
 * placements are relative to north-up. Optimiser settings (generations, population, seed) and the
 * sheet outline are excluded: changing them doesn't make an existing layout wrong.
 */
export function nestInputKey(s: ProjectSettings): string {
  const n = s.nest
  const joint =
    s.joint === 'finger' ? ['finger', s.fingerWidthMm, s.fingerTip, s.fingerClearanceMm] : ['butt']
  // q and −q are the same rotation.
  const [x, y, z, w] = s.rotation
  const sign = w < 0 || (w === 0 && (z < 0 || (z === 0 && (y < 0 || (y === 0 && x < 0))))) ? -1 : 1
  const rotation = n.rotationMode === 'free' ? null : s.rotation.map((c) => r9(c * sign) + 0) // +0 drops −0
  return hash53(
    JSON.stringify([
      s.polyhedron.vertices.map((v) => v.map(r9)),
      s.polyhedron.faces,
      s.edgeLengthMm,
      s.thicknessMm,
      s.kerfEnabled ? s.kerfMm : 0,
      joint,
      n.sheetWidthMm,
      n.sheetHeightMm,
      n.gapMm,
      n.marginMm,
      n.rotationMode,
      n.rotationMode === 'free' ? n.rotationStepDeg : null,
      rotation,
    ]),
  )
}

/** The saved layout if it was made for these settings, else null. */
export function currentLayout(s: ProjectSettings): NestLayout | null {
  return s.nestLayout && s.nestLayout.inputKey === nestInputKey(s) ? s.nestLayout : null
}
