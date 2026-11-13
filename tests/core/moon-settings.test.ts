import { describe, expect, it } from 'vitest'

import { parseProject, serializeProject } from '@/core/export/project-file'
import {
  DEFAULT_LAYER_STYLES,
  FILL_SHORES,
  fillsNeeded,
  layerInSubject,
  lightBurnIndex,
  subjectStyles,
} from '@/core/layers'
import { DEFAULT_SETTINGS, type ProjectSettings, isCraterMinDiameter } from '@/core/settings'

describe('Moon layers', () => {
  it('belong to the Moon only, with the cut and guide shared', () => {
    for (const id of ['maria', 'craters', 'moonGrid'] as const) {
      expect(layerInSubject(id, 'moon')).toBe(true)
      expect(layerInSubject(id, 'earth')).toBe(false)
      expect(layerInSubject(id, 'sky')).toBe(false)
    }
    expect(layerInSubject('cut', 'moon')).toBe(true)
    expect(layerInSubject('guide', 'moon')).toBe(true)
    expect(layerInSubject('coastlines', 'moon')).toBe(false)
    expect(layerInSubject('stars', 'moon')).toBe(false)
  })

  it('default to maria outlines and craters on, the grid off, in LightBurn colours', () => {
    const { maria, craters, moonGrid } = DEFAULT_LAYER_STYLES
    expect(maria).toMatchObject({ enabled: true, mode: 'stroke' })
    expect(craters).toMatchObject({ enabled: true, mode: 'stroke' })
    expect(moonGrid).toMatchObject({ enabled: false, mode: 'stroke' })
    expect([maria, craters, moonGrid].map((s) => lightBurnIndex(s.color))).toEqual([
      '01',
      '00',
      '03',
    ])
    expect(FILL_SHORES.maria).toBe('mariaEdge')
    expect(DEFAULT_LAYER_STYLES.craterShadows).toMatchObject({ enabled: true, mode: 'fill' })
    expect(lightBurnIndex(DEFAULT_LAYER_STYLES.craterShadows.color)).toBe('07')
    expect(FILL_SHORES.craterShadows).toBe('craterShadowEdge')
    expect(layerInSubject('craterShadows', 'moon')).toBe(true)
    expect(layerInSubject('craterShadows', 'earth')).toBe(false)
  })

  it('switch off every other subject in Moon mode, and vice versa', () => {
    const moon = subjectStyles(DEFAULT_LAYER_STYLES, 'moon')
    expect(moon.coastlines.enabled).toBe(false)
    expect(moon.stars.enabled).toBe(false)
    expect(moon.maria.enabled).toBe(true)
    expect(moon.craters.enabled).toBe(true)
    expect(subjectStyles(DEFAULT_LAYER_STYLES, 'earth').craters.enabled).toBe(false)
    expect(subjectStyles(DEFAULT_LAYER_STYLES, 'sky').maria.enabled).toBe(false)
  })

  it('compute the maria fill only in a fill mode', () => {
    expect(fillsNeeded(DEFAULT_LAYER_STYLES).maria).toBe(false)
    const filled = { ...DEFAULT_LAYER_STYLES.maria, mode: 'both' as const }
    expect(fillsNeeded({ ...DEFAULT_LAYER_STYLES, maria: filled }).maria).toBe(true)
  })
})

describe('Moon settings', () => {
  it('limit the crater slider to 10–300 km', () => {
    expect(isCraterMinDiameter(10)).toBe(true)
    expect(isCraterMinDiameter(300)).toBe(true)
    expect(isCraterMinDiameter(9.9)).toBe(false)
    expect(isCraterMinDiameter(301)).toBe(false)
    expect(DEFAULT_SETTINGS.craterMinDiameterKm).toBe(30)
    expect(DEFAULT_SETTINGS.moonGridIntervalDeg).toBe(15)
  })

  it('round-trip through the project file', () => {
    const s: ProjectSettings = {
      ...DEFAULT_SETTINGS,
      subject: 'moon',
      craterMinDiameterKm: 75,
      moonGridIntervalDeg: 10,
      layerStyles: {
        ...DEFAULT_LAYER_STYLES,
        maria: { ...DEFAULT_LAYER_STYLES.maria, mode: 'fill' },
      },
    }
    const { settings, notes } = parseProject(serializeProject(s))
    expect(notes).toEqual([])
    expect({ ...settings, rotation: null }).toEqual({ ...s, rotation: null })
  })

  it('open older files with Moon defaults and layers', () => {
    const file = JSON.parse(serializeProject(DEFAULT_SETTINGS)) as Record<string, unknown> & {
      layerStyles: Record<string, unknown>
    }
    delete file.craterMinDiameterKm
    delete file.moonGridIntervalDeg
    for (const id of ['maria', 'craters', 'moonGrid']) delete file.layerStyles[id]
    const { settings, notes } = parseProject(JSON.stringify(file))
    expect(notes).toEqual([])
    expect(settings.craterMinDiameterKm).toBe(30)
    expect(settings.moonGridIntervalDeg).toBe(15)
    expect(settings.layerStyles.maria).toEqual(DEFAULT_LAYER_STYLES.maria)
  })

  it('replace out-of-range Moon values with defaults and say so', () => {
    const file = {
      ...(JSON.parse(serializeProject(DEFAULT_SETTINGS)) as object),
      subject: 'moon',
      craterMinDiameterKm: 5,
      moonGridIntervalDeg: 7,
    }
    const { settings, notes } = parseProject(JSON.stringify(file))
    expect(settings.subject).toBe('moon')
    expect(settings.craterMinDiameterKm).toBe(30)
    expect(settings.moonGridIntervalDeg).toBe(15)
    expect(notes.join(' ')).toMatch(/craterMinDiameterKm/)
    expect(notes.join(' ')).toMatch(/moonGridIntervalDeg/)
  })
})
