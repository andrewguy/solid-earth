import { describe, expect, it } from 'vitest'

import { parseProject, serializeProject } from '@/core/export/project-file'
import { DEFAULT_LAYER_STYLES } from '@/core/layers'
import { currentLayout, nestInputKey } from '@/core/nest/key'
import {
  DEFAULT_NEST_SETTINGS,
  type NestLayout,
  type NestSettings,
  ROTATION_STEPS,
  SHEET_PRESETS,
} from '@/core/nest/types'
import { preset } from '@/core/polyhedron/presets'
import { fromAxisAngle } from '@/core/quat'
import { DEFAULT_SETTINGS, type ProjectSettings } from '@/core/settings'

const base: ProjectSettings = { ...DEFAULT_SETTINGS, preset: 'cube', polyhedron: preset('cube') }
const withNest = (s: ProjectSettings, patch: Partial<NestSettings>): ProjectSettings => ({
  ...s,
  nest: { ...s.nest, ...patch },
})
const key = nestInputKey

const layoutFor = (s: ProjectSettings, faces = 6): NestLayout => ({
  inputKey: key(s),
  sheetCount: 2,
  placements: Array.from({ length: faces - 1 }, (_, i) => ({
    face: i,
    sheet: i % 2,
    x: 10 + i,
    y: 20.5,
    angleDeg: 15 * i,
  })),
  unplaced: [faces - 1],
})

const raw = (o: object) => JSON.stringify({ app: 'solid-earth', schemaVersion: 1, ...o })

describe('nest settings defaults', () => {
  it('match plan §13', () => {
    expect(DEFAULT_SETTINGS.nest).toEqual(DEFAULT_NEST_SETTINGS)
    expect(DEFAULT_SETTINGS.nestLayout).toBeNull()
    expect(DEFAULT_NEST_SETTINGS).toMatchObject({
      gapMm: 2,
      marginMm: 5,
      rotationMode: 'free',
      rotationStepDeg: 15,
      generations: 20,
      population: 10,
    })
  })

  it('offer steps that divide 360 and unique landscape presets', () => {
    for (const step of ROTATION_STEPS) expect(360 % step).toBe(0)
    expect(new Set(SHEET_PRESETS.map((p) => p.id)).size).toBe(SHEET_PRESETS.length)
    for (const p of SHEET_PRESETS) expect(p.widthMm).toBeGreaterThanOrEqual(p.heightMm)
    const d = DEFAULT_NEST_SETTINGS
    const p = SHEET_PRESETS.find((x) => x.id === d.sheetPreset)!
    expect([p.widthMm, p.heightMm]).toEqual([d.sheetWidthMm, d.sheetHeightMm])
  })
})

describe('nestInputKey', () => {
  const finger: ProjectSettings = { ...base, joint: 'finger' }
  const restricted = withNest(base, { rotationMode: 'none' })

  it('is a stable hex string', () => {
    expect(key(base)).toMatch(/^[0-9a-f]{14}$/)
    expect(key({ ...base })).toBe(key(base))
  })

  it.each<[string, ProjectSettings, ProjectSettings]>([
    ['shape', base, { ...base, preset: 'octahedron', polyhedron: preset('octahedron') }],
    ['edge length', base, { ...base, edgeLengthMm: 101 }],
    ['thickness', base, { ...base, thicknessMm: 4 }],
    ['kerf on', base, { ...base, kerfEnabled: true }],
    ['kerf amount', { ...base, kerfEnabled: true }, { ...base, kerfEnabled: true, kerfMm: 0.2 }],
    ['joint', base, finger],
    ['finger width', finger, { ...finger, fingerWidthMm: 12 }],
    ['finger tip', finger, { ...finger, fingerTip: 'flush' }],
    ['finger clearance', finger, { ...finger, fingerClearanceMm: 0 }],
    ['sheet width', base, withNest(base, { sheetWidthMm: 601 })],
    ['sheet height', base, withNest(base, { sheetHeightMm: 401 })],
    ['gap', base, withNest(base, { gapMm: 3 })],
    ['margin', base, withNest(base, { marginMm: 6 })],
    ['rotation mode', base, withNest(base, { rotationMode: '90' })],
    ['free rotation step', base, withNest(base, { rotationStepDeg: 30 })],
    [
      'globe rotation (restricted mode)',
      restricted,
      { ...restricted, rotation: fromAxisAngle([0, 1, 0], 0.3) },
    ],
  ])('changes with %s', (_, a, b) => {
    expect(key(b)).not.toBe(key(a))
  })

  it.each<[string, ProjectSettings, ProjectSettings]>([
    ['kerf amount while kerf is off', base, { ...base, kerfMm: 0.3 }],
    ['finger settings with butt joints', base, { ...base, fingerWidthMm: 20, fingerTip: 'flush' }],
    ['resolution', base, { ...base, resolution: '110m' }],
    [
      'layer styles',
      base,
      {
        ...base,
        layerStyles: {
          ...DEFAULT_LAYER_STYLES,
          land: { ...DEFAULT_LAYER_STYLES.land, enabled: true },
        },
      },
    ],
    ['graticule', base, { ...base, graticuleIntervalDeg: 30 }],
    ['globe rotation (free mode)', base, { ...base, rotation: fromAxisAngle([0, 1, 0], 0.3) }],
    ['step outside free mode', restricted, withNest(restricted, { rotationStepDeg: 45 })],
    ['optimiser settings', base, withNest(base, { generations: 500, population: 50, seed: 9 })],
    ['sheet preset label', base, withNest(base, { sheetPreset: 'custom' })],
    ['the saved layout', base, { ...base, nestLayout: layoutFor(base) }],
  ])('ignores %s', (_, a, b) => {
    expect(key(b)).toBe(key(a))
  })

  it('treats q and −q as the same rotation', () => {
    const q = fromAxisAngle([1, 2, 3], 0.7)
    const a = { ...restricted, rotation: q }
    const b = { ...restricted, rotation: q.map((c) => -c) as unknown as typeof q }
    expect(key(b)).toBe(key(a))
  })
})

describe('currentLayout', () => {
  it('returns the layout only while its key matches', () => {
    const s = { ...base, nestLayout: layoutFor(base) }
    expect(currentLayout(s)).toBe(s.nestLayout)
    expect(currentLayout({ ...s, edgeLengthMm: 50 })).toBeNull()
    expect(currentLayout(base)).toBeNull()
  })

  it('survives a save and reload, with a custom shape and rotation', () => {
    const custom: ProjectSettings = {
      ...base,
      preset: null,
      polyhedron: { ...preset('truncated-icosahedron'), name: 'ball' },
      rotation: fromAxisAngle([1, 2, 3], 0.7),
      nest: { ...DEFAULT_NEST_SETTINGS, rotationMode: '180' },
    }
    const saved = { ...custom, nestLayout: layoutFor(custom, 32) }
    const { settings, notes } = parseProject(serializeProject(saved))
    expect(notes).toEqual([])
    expect(settings.nestLayout).toEqual(saved.nestLayout)
    expect(currentLayout(settings)).not.toBeNull()
  })
})

describe('project files: nesting', () => {
  it('round-trips nest settings and layout', () => {
    const s: ProjectSettings = {
      ...base,
      nest: {
        sheetPreset: 'custom',
        sheetWidthMm: 450,
        sheetHeightMm: 320.5,
        gapMm: 1.5,
        marginMm: 0,
        rotationMode: '90',
        rotationStepDeg: 5,
        generations: 200,
        population: 30,
        seed: 42,
      },
    }
    const saved = { ...s, nestLayout: layoutFor(s) }
    const { settings, notes } = parseProject(serializeProject(saved))
    expect(notes).toEqual([])
    expect(settings.nest).toEqual(saved.nest)
    expect(settings.nestLayout).toEqual(saved.nestLayout)
  })

  it('uses defaults for files without nesting', () => {
    const { settings, notes } = parseProject(raw({ preset: 'cube' }))
    expect(notes).toEqual([])
    expect(settings.nest).toEqual(DEFAULT_NEST_SETTINGS)
    expect(settings.nestLayout).toBeNull()
  })

  it('replaces invalid nest values with defaults and says so', () => {
    const { settings, notes } = parseProject(
      raw({
        preset: 'cube',
        nest: {
          sheetWidthMm: 5,
          gapMm: -1,
          rotationMode: 'sideways',
          rotationStepDeg: 7,
          generations: 2.5,
          population: 1,
          seed: -3,
        },
      }),
    )
    expect(settings.nest).toEqual(DEFAULT_NEST_SETTINGS)
    expect(notes).toHaveLength(7)
    expect(parseProject(raw({ preset: 'cube', nest: 'big' })).notes).toEqual([
      'sheet settings were unreadable; using defaults',
    ])
  })

  it('keeps a sheet preset only while the size matches it, in either orientation', () => {
    const parse = (nest: object) => parseProject(raw({ preset: 'cube', nest })).settings.nest
    expect(parse({ sheetPreset: 'a3', sheetWidthMm: 420, sheetHeightMm: 297 }).sheetPreset).toBe(
      'a3',
    )
    expect(parse({ sheetPreset: 'a3', sheetWidthMm: 297, sheetHeightMm: 420 }).sheetPreset).toBe(
      'a3',
    )
    expect(parse({ sheetPreset: 'a3', sheetWidthMm: 300, sheetHeightMm: 297 }).sheetPreset).toBe(
      'custom',
    )
    expect(parse({ sheetPreset: 'nope', sheetWidthMm: 420, sheetHeightMm: 297 }).sheetPreset).toBe(
      'custom',
    )
  })

  const good = layoutFor(base)
  it.each<[string, unknown]>([
    ['not an object', 'layout'],
    ['no key', { ...good, inputKey: 3 }],
    ['a negative sheet count', { ...good, sheetCount: -1 }],
    ['a duplicate face', { ...good, unplaced: [0] }],
    ['a missing face', { ...good, unplaced: [] }],
    ['a face out of range', { ...good, unplaced: [5, 6] }],
    ['a sheet out of range', { ...good, sheetCount: 1 }],
    [
      'a non-numeric position',
      { ...good, placements: [{ ...good.placements[0], x: 'a' }, ...good.placements.slice(1)] },
    ],
    ['a layout for a different shape', layoutFor(base, 20)],
  ])('discards a layout with %s', (_, nestLayout) => {
    const { settings, notes } = parseProject(raw({ preset: 'cube', nestLayout }))
    expect(settings.nestLayout).toBeNull()
    expect(notes).toEqual(['the saved sheet layout was invalid and has been discarded; nest again'])
  })
})
