import { describe, expect, it } from 'vitest'

import {
  PROJECT_SCHEMA_VERSION,
  ProjectFileError,
  parseProject,
  projectFileName,
  serializeProject,
} from '@/core/export/project-file'
import { DEFAULT_LAYER_STYLES } from '@/core/layers'
import { preset } from '@/core/polyhedron/presets'
import { fromAxisAngle } from '@/core/quat'
import { DEFAULT_SETTINGS, type ProjectSettings } from '@/core/settings'

const custom: ProjectSettings = {
  ...DEFAULT_SETTINGS,
  preset: null,
  polyhedron: { ...preset('cube'), name: 'my-box' },
  rotation: fromAxisAngle([1, 2, 3], 0.7),
  edgeLengthMm: 123.4,
  resolution: '110m',
  layerStyles: {
    ...DEFAULT_LAYER_STYLES,
    land: { ...DEFAULT_LAYER_STYLES.land, enabled: true, mode: 'both', color: '#FF8000' },
  },
  graticuleIntervalDeg: 10,
  thicknessMm: 6,
  kerfEnabled: true,
  kerfMm: 0.2,
  detail10m: 0.4,
}

const raw = (o: object) =>
  JSON.stringify({ app: 'polyhedral-map-projector', schemaVersion: 1, ...o })

describe('project files', () => {
  it('round-trips every setting, including an embedded custom shape', () => {
    const { settings, notes } = parseProject(serializeProject(custom))
    expect(notes).toEqual([])
    expect(settings.preset).toBeNull()
    expect(settings.polyhedron.faces).toEqual(custom.polyhedron.faces)
    expect(settings.polyhedron.name).toBe('my-box')
    // Polyhedron is re-validated and rotation renormalised, so compare those separately.
    expect({ ...settings, polyhedron: null, rotation: null }).toEqual({
      ...custom,
      polyhedron: null,
      rotation: null,
    })
    settings.rotation.forEach((c, i) => expect(c).toBeCloseTo(custom.rotation[i]!, 12))
  })

  it('rebuilds presets from code rather than trusting the file', () => {
    const text = serializeProject({
      ...DEFAULT_SETTINGS,
      preset: 'dodecahedron',
      polyhedron: preset('cube'),
    })
    expect(parseProject(text).settings.polyhedron).toBe(preset('dodecahedron'))
  })

  it('names the file after the shape', () => {
    expect(projectFileName(custom)).toBe('my-box_project.json')
  })

  it('fills in anything missing with defaults', () => {
    const { settings, notes } = parseProject(raw({ preset: 'cube' }))
    expect(notes).toEqual([])
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, preset: 'cube', polyhedron: preset('cube') })
  })

  it('replaces invalid values with defaults and says so', () => {
    const { settings, notes } = parseProject(
      raw({
        preset: 'cube',
        edgeLengthMm: -5,
        resolution: '1m',
        rotation: [0, 0, 0, 0],
        graticuleIntervalDeg: 7,
        kerfMm: 'wide',
        layerStyles: {
          coastlines: { color: '#123456', mode: 'sideways', enabled: false },
          nonsense: { enabled: true },
        },
      }),
    )
    expect(settings.edgeLengthMm).toBe(DEFAULT_SETTINGS.edgeLengthMm)
    expect(settings.resolution).toBe(DEFAULT_SETTINGS.resolution)
    expect(settings.rotation).toEqual(DEFAULT_SETTINGS.rotation)
    expect(settings.graticuleIntervalDeg).toBe(15)
    expect(settings.kerfMm).toBe(DEFAULT_SETTINGS.kerfMm)
    expect(settings.layerStyles.coastlines).toEqual({
      ...DEFAULT_LAYER_STYLES.coastlines,
      enabled: false, // the valid part is kept
    })
    expect(notes.join(' ')).toMatch(/edgeLengthMm.*resolution|resolution.*edgeLengthMm/s)
    expect(notes.some((n) => n.includes('#123456') && n.includes('LightBurn'))).toBe(true)
  })

  it('accepts lower-case palette colours', () => {
    const { settings } = parseProject(raw({ layerStyles: { rivers: { color: '#0000ff' } } }))
    expect(settings.layerStyles.rivers.color).toBe('#0000FF')
  })

  it.each([
    ['{', /not JSON/],
    ['[]', /not a Polyhedral Map Projector project/],
    [JSON.stringify({ app: 'other', schemaVersion: 1 }), /not a Polyhedral Map Projector project/],
    [raw({ schemaVersion: PROJECT_SCHEMA_VERSION + 1 }), /newer version/],
    [raw({ schemaVersion: 'one' }), /schema version/],
    [raw({ polyhedron: { vertices: 'x', faces: [] } }), /malformed/],
    [
      raw({
        polyhedron: {
          name: 'open box',
          vertices: preset('cube').vertices,
          faces: preset('cube').faces.slice(1),
        },
      }),
      /shape in this project is invalid: not closed/,
    ],
  ])('rejects unusable file %#', (text, pattern) => {
    expect(() => parseProject(text)).toThrow(ProjectFileError)
    expect(() => parseProject(text)).toThrow(pattern)
  })
})
