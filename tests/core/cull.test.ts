import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { boundingCap, capsOverlap, faceCap } from '@/core/clip/cull'
import { clipPolylineToCone } from '@/core/clip/polyline'
import { buildFrames } from '@/core/polyhedron/faces'
import { icosahedron } from '@/core/polyhedron/presets'
import { angle } from '@/core/vec3'

import { sphericalPolyline } from '../arbitraries'

const frames = buildFrames(icosahedron())

describe('culling caps', () => {
  it('bounding cap contains every point', () => {
    fc.assert(
      fc.property(sphericalPolyline, (pts) => {
        const cap = boundingCap(pts)
        return pts.every((p) => angle(cap.centre, p) <= cap.radius + 1e-12)
      }),
    )
  })

  it('never culls a line that has visible pieces on a face', () => {
    fc.assert(
      fc.property(sphericalPolyline, (pts) => {
        const cap = boundingCap(pts)
        return frames.faces.every(
          (f) => capsOverlap(faceCap(f), cap) || clipPolylineToCone(pts, f.edgePlanes).length === 0,
        )
      }),
    )
  })

  it('actually culls: a short line overlaps only a few icosahedron faces', () => {
    const pts = [frames.faces[0]!.normal]
    const overlapping = frames.faces.filter((f) => capsOverlap(faceCap(f), boundingCap(pts)))
    expect(overlapping.length).toBeLessThan(5)
  })
})
