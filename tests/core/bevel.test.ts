import { describe, expect, it } from 'vitest'

import { parseProject, serializeProject } from '@/core/export/project-file'
import { DEFAULT_SVG_OPTIONS, faceToSvg } from '@/core/export/svg'
import { prepareLines } from '@/core/geo/lines'
import { graticuleLines } from '@/core/geo/topojson'
import type { JointOptions } from '@/core/joints'
import { DEFAULT_LAYER_STYLES, lightBurnIndex } from '@/core/layers'
import { PanelError, bevelOutlines, bevelTiltDeg, panelOutline } from '@/core/panel'
import { ringArea } from '@/core/planar/clipper'
import { buildAllFaces, longestEdge, prepareMap } from '@/core/pipeline'
import { buildFrames } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import { DEFAULT_SETTINGS, type ProjectSettings, jointOptions } from '@/core/settings'
import type { Vec2 } from '@/core/vec3'

const DEG = Math.PI / 180

/** Signed distance of p from the directed line a→b; positive on the left (inside a CCW ring). */
function leftOf(a: Vec2, b: Vec2, p: Vec2): number {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  return (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / Math.hypot(ex, ey)
}

/** Smallest signed distance of p inside a CCW convex ring. */
const insideBy = (ring: readonly Vec2[], p: Vec2) =>
  Math.min(...ring.map((a, k) => leftOf(a, ring[(k + 1) % ring.length]!, p)))

describe('bevel tilt', () => {
  it('is V/2 from square', () => {
    expect(bevelTiltDeg(90 * DEG)).toBeCloseTo(45, 12) // cube
    expect(bevelTiltDeg(138.1897 * DEG)).toBeCloseTo(20.905, 3) // icosahedron
    expect(bevelTiltDeg(180 * DEG)).toBeCloseTo(0, 12)
  })
})

describe('bevelOutlines', () => {
  const SHAPES: PresetId[] = ['cube', 'icosahedron', 'truncated-icosahedron', 'tetrahedron']

  it.each(SHAPES)(
    '%s: the guide is the true face; each cut edge sits the allowance outside it',
    (id) => {
      const frames = buildFrames(preset(id))
      const allowance = 0.02
      for (const face of frames.faces) {
        const { guide, cut } = bevelOutlines(frames, face.index, 0.01, allowance)
        expect(guide).toEqual(face.vertices2D)
        expect(cut).toHaveLength(guide.length)
        expect(ringArea(cut)).toBeGreaterThan(ringArea(guide))
        guide.forEach((a, k) => {
          const b = guide[(k + 1) % guide.length]!
          const [p, q] = [cut[k]!, cut[(k + 1) % cut.length]!]
          // Both ends of cut edge k lie on the line parallel to guide edge k, the allowance out.
          expect(leftOf(a, b, p)).toBeCloseTo(-allowance, 12)
          expect(leftOf(a, b, q)).toBeCloseTo(-allowance, 12)
          // Sharp corners: every guide vertex is inside the cut by at least the allowance.
          expect(insideBy(cut, a)).toBeCloseTo(allowance, 12)
        })
      }
    },
  )

  it('with no allowance, cuts on the guide', () => {
    const frames = buildFrames(preset('icosahedron'))
    const { guide, cut } = bevelOutlines(frames, 3, 0.1, 0)
    expect(cut).toEqual(guide)
  })

  it('ignores thickness for the lines but rejects material too thick for a back face', () => {
    const frames = buildFrames(preset('cube'))
    expect(bevelOutlines(frames, 0, 0.1, 0.1)).toEqual(bevelOutlines(frames, 0, 0, 0.1))
    expect(() => panelOutline(frames, 0, 1.5)).toThrow(PanelError)
    expect(() => bevelOutlines(frames, 0, 1.5, 0.1)).toThrow(/bevels leave no back face/)
  })
})

describe('bevel artwork', () => {
  const frames = buildFrames(preset('truncated-icosahedron'))
  const mmPerUnit = 100 / longestEdge(frames)
  const allowanceMm = 0.5
  const joint: JointOptions = { kind: 'bevel', allowanceMm }
  const map = prepareMap({ graticule: prepareLines(graticuleLines(10), 0.5, { keepSeams: true }) })
  const options = { mmPerUnit, precisionMm: null, thicknessMm: 3, joint, fills: { ocean: true } }
  const arts = buildAllFaces(frames, map, options)

  it('engraves the guide on the true face and cuts the allowance outside it', () => {
    for (const art of arts) {
      const face = frames.faces[art.faceIndex]!
      expect(art.guide).toHaveLength(face.vertices2D.length)
      art.guide!.forEach((a, k) => {
        const b = art.guide![(k + 1) % art.guide!.length]!
        expect(leftOf(a, b, art.outline[k]!)).toBeCloseTo(-allowanceMm, 9)
      })
      expect(art.cutOutline).toEqual(art.outline) // kerf off
    }
  })

  it('runs the map past the guide, out to the cut line but no further', () => {
    let beyond = 0
    for (const art of arts) {
      const pts = (art.lines.graticule ?? []).flat()
      expect(pts.length).toBeGreaterThan(0)
      for (const p of pts) {
        expect(insideBy(art.outline, p)).toBeGreaterThan(-1e-6)
        if (insideBy(art.guide!, p) < -0.25) beyond++
      }
    }
    expect(beyond).toBeGreaterThan(0)
  })

  it('fills the ocean right out to the cut line', () => {
    for (const art of arts) {
      const area = (art.fills.ocean ?? []).reduce((s, r) => s + ringArea(r), 0)
      expect(Math.abs(area / ringArea(art.outline) - 1)).toBeLessThan(1e-4)
    }
  })

  it('writes the guide on its own LightBurn 04 layer, under the cut, only in bevel mode', () => {
    const svgOptions = { ...DEFAULT_SVG_OPTIONS, styles: DEFAULT_LAYER_STYLES }
    const svg = faceToSvg(arts[0]!, svgOptions)
    expect(lightBurnIndex(DEFAULT_LAYER_STYLES.guide.color)).toBe('04')
    expect(svg).toContain('inkscape:label="Sanding guide"')
    expect(svg).toContain(`stroke="${DEFAULT_LAYER_STYLES.guide.color}"`)
    expect(svg.indexOf('layer-guide')).toBeLessThan(svg.indexOf('layer-cut'))

    const off = { ...DEFAULT_LAYER_STYLES.guide, enabled: false }
    const hidden = faceToSvg(arts[0]!, {
      ...DEFAULT_SVG_OPTIONS,
      styles: { ...DEFAULT_LAYER_STYLES, guide: off },
    })
    expect(hidden).not.toContain('layer-guide')

    const [butt] = buildAllFaces(frames, map, { ...options, joint: { kind: 'butt' } })
    expect(butt!.guide).toBeUndefined()
    expect(faceToSvg(butt!, svgOptions)).not.toContain('layer-guide')
  })
})

describe('bevel settings', () => {
  const bevel: ProjectSettings = { ...DEFAULT_SETTINGS, joint: 'bevel', bevelAllowanceMm: 0.8 }

  it('map to joint options', () => {
    expect(jointOptions(bevel)).toEqual({ kind: 'bevel', allowanceMm: 0.8 })
  })

  it('round-trip through a project file', () => {
    const { settings, notes } = parseProject(serializeProject(bevel))
    expect(notes).toEqual([])
    expect(settings.joint).toBe('bevel')
    expect(settings.bevelAllowanceMm).toBe(0.8)
  })

  it('default the allowance, and the guide layer, for older files', () => {
    // A file from before bevels: no allowance and no guide layer.
    const file = JSON.parse(serializeProject(DEFAULT_SETTINGS)) as Record<string, unknown> & {
      layerStyles: Record<string, unknown>
    }
    delete file.bevelAllowanceMm
    delete file.layerStyles.guide
    const { settings, notes } = parseProject(JSON.stringify(file))
    expect(notes).toEqual([])
    expect(settings.bevelAllowanceMm).toBe(DEFAULT_SETTINGS.bevelAllowanceMm)
    expect(settings.layerStyles.guide).toEqual(DEFAULT_LAYER_STYLES.guide)
  })

  it('replace an out-of-range allowance with the default and say so', () => {
    const text = JSON.stringify({
      ...JSON.parse(serializeProject(bevel)),
      bevelAllowanceMm: 9,
    })
    const { settings, notes } = parseProject(text)
    expect(settings.bevelAllowanceMm).toBe(DEFAULT_SETTINGS.bevelAllowanceMm)
    expect(notes.join(' ')).toMatch(/bevelAllowanceMm/)
  })
})
