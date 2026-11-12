import { describe, expect, it } from 'vitest'

import { nestInputKey } from '@/core/nest/key'
import { STALE_LAYOUT_WARNING, nestWarnings, sheetsForZip } from '@/core/nest/status'
import type { NestLayout } from '@/core/nest/types'
import { preset } from '@/core/polyhedron/presets'
import { DEFAULT_SETTINGS, type ProjectSettings } from '@/core/settings'

const base: ProjectSettings = { ...DEFAULT_SETTINGS, preset: 'cube', polyhedron: preset('cube') }

const layout = (s: ProjectSettings, unplaced: number[] = [], sheetCount = 2): NestLayout => ({
  inputKey: nestInputKey(s),
  sheetCount,
  placements: [0, 1, 2, 3, 4, 5]
    .filter((f) => !unplaced.includes(f))
    .map((face) => ({ face, sheet: face % sheetCount, x: 0, y: 0, angleDeg: 0 })),
  unplaced,
})

describe('nestWarnings', () => {
  it('is quiet without a layout, or with a current one that placed everything', () => {
    expect(nestWarnings(base)).toEqual([])
    expect(nestWarnings({ ...base, nestLayout: layout(base) })).toEqual([])
  })

  it('warns when the layout is stale', () => {
    const s = { ...base, nestLayout: layout(base), edgeLengthMm: 120 }
    expect(nestWarnings(s)).toEqual([STALE_LAYOUT_WARNING])
  })

  it('lists panels that do not fit', () => {
    const [one] = nestWarnings({ ...base, nestLayout: layout(base, [4]) })
    expect(one).toMatch(/^1 panel does not fit the 600 × 400 mm sheet/)
    expect(one).toContain('(face 04)')
    const [many] = nestWarnings({ ...base, nestLayout: layout(base, [1, 3]) })
    expect(many).toMatch(/^2 panels do not fit/)
    expect(many).toContain('are left off the sheets (faces 01, 03)')
  })
})

describe('sheetsForZip', () => {
  const svgs = ['<svg 1/>', '<svg 2/>']

  it('includes the rendered sheets of a current layout', () => {
    expect(sheetsForZip({ ...base, nestLayout: layout(base) }, svgs)).toEqual({
      sheets: svgs,
      warning: null,
    })
  })

  it('adds nothing, silently, without a layout or when nothing was placed', () => {
    expect(sheetsForZip(base, svgs)).toEqual({ sheets: [], warning: null })
    const none = layout(base, [0, 1, 2, 3, 4, 5], 0)
    expect(sheetsForZip({ ...base, nestLayout: none }, [])).toEqual({ sheets: [], warning: null })
  })

  it('leaves the sheets out, with a warning, when the layout is stale', () => {
    const r = sheetsForZip({ ...base, nestLayout: layout(base), thicknessMm: 6 }, svgs)
    expect(r.sheets).toEqual([])
    expect(r.warning).toContain('left out of the ZIP')
    expect(r.warning).toContain(STALE_LAYOUT_WARNING)
  })

  it('never exports a previous render: the SVG count must match the layout', () => {
    const s = { ...base, nestLayout: layout(base) }
    for (const stale of [null, [], ['<svg 1/>'], [...svgs, '<svg 3/>']]) {
      const r = sheetsForZip(s, stale)
      expect(r.sheets).toEqual([])
      expect(r.warning).toMatch(/still rendering/)
    }
  })
})
