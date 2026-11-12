import { describe, expect, it } from 'vitest'

import type { JointOptions } from '@/core/joints'
import { ringArea } from '@/core/planar/clipper'
import { panelShape, panelShapes } from '@/core/panel-shape'
import { type PreparedMap, buildAllFaces, longestEdge } from '@/core/pipeline'
import { buildFrames } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import { rotate2D } from '@/core/project/orientation'
import { type Vec3, normalize } from '@/core/vec3'

const EMPTY_MAP: PreparedMap = { lines: {}, polygons: {} }
const EDGE_MM = 100
/** An arbitrary tilted north, so export rotations are non-trivial. */
const NORTH: Vec3 = normalize([0.3, -0.2, 0.9])
const FINGER: JointOptions = { kind: 'finger', widthMm: 10, tip: 'fill', clearanceMm: 0.1 }

/** Export rounds to 0.01 mm; kerf offsets go through Clipper's 0.001 mm grid. */
const TOL = 0.011

const CASES: { shape: PresetId; joint: JointOptions; kerfMm: number }[] = [
  { shape: 'icosahedron', joint: { kind: 'butt' }, kerfMm: 0 },
  { shape: 'icosahedron', joint: { kind: 'butt' }, kerfMm: 0.15 },
  { shape: 'icosahedron', joint: FINGER, kerfMm: 0.15 },
  { shape: 'truncated-icosahedron', joint: { kind: 'butt' }, kerfMm: 0.15 },
  { shape: 'truncated-icosahedron', joint: FINGER, kerfMm: 0 },
  { shape: 'rhombic-triacontahedron', joint: FINGER, kerfMm: 0.15 },
]

describe('panelShape', () => {
  it.each(CASES)(
    'matches FaceArtwork in the face frame: $shape, $joint.kind, kerf $kerfMm',
    ({ shape, joint, kerfMm }) => {
      const frames = buildFrames(preset(shape))
      const options = {
        mmPerUnit: EDGE_MM / longestEdge(frames),
        kerfMm,
        thicknessMm: 3,
        joint,
        north: NORTH,
      }
      const arts = buildAllFaces(frames, EMPTY_MAP, { ...options, precisionMm: 0.01 })
      const shapes = panelShapes(frames, options)
      expect(shapes).toHaveLength(arts.length)
      shapes.forEach((s, i) => {
        const art = arts[i]!
        expect(s.faceIndex).toBe(i)
        expect(s.rotation).toBeCloseTo(art.rotation, 12)
        for (const [mine, theirs] of [
          [s.outline, art.outline],
          [s.cutOutline, art.cutOutline],
        ] as const) {
          expect(mine).toHaveLength(theirs.length)
          mine.forEach((p, k) => {
            const back = rotate2D(theirs[k]!, -art.rotation)
            expect(Math.hypot(p[0] - back[0], p[1] - back[1])).toBeLessThan(TOL)
          })
        }
      })
    },
  )

  it('is independent of the globe rotation apart from `rotation`', () => {
    const frames = buildFrames(preset('icosahedron'))
    const base = { mmPerUnit: 50, thicknessMm: 3, joint: FINGER }
    const a = panelShape(frames, 7, base)
    const b = panelShape(frames, 7, { ...base, north: NORTH })
    expect(a.rotation).toBe(0)
    expect(b.rotation).not.toBe(0)
    expect(b.outline).toEqual(a.outline)
    expect(b.cutOutline).toEqual(a.cutOutline)
  })

  it('returns CCW outlines, with kerf growing the cut path', () => {
    const frames = buildFrames(preset('cube'))
    const s = panelShape(frames, 0, { mmPerUnit: 100, thicknessMm: 3, kerfMm: 0.2 })
    expect(ringArea(s.outline)).toBeGreaterThan(0)
    expect(ringArea(s.cutOutline)).toBeGreaterThan(ringArea(s.outline))
    // A cube face with 3 mm butt insets on 90° edges: (100 − 6)², and +0.1 mm per side with kerf.
    expect(ringArea(s.outline)).toBeCloseTo(94 ** 2, 6)
    expect(ringArea(s.cutOutline)).toBeCloseTo(94.2 ** 2, 2)
  })

  it('rejects an unknown face', () => {
    const frames = buildFrames(preset('cube'))
    expect(() => panelShape(frames, 6, { mmPerUnit: 1 })).toThrow(/no face 6/)
  })
})
