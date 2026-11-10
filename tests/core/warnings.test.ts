import { describe, expect, it } from 'vitest'

import { buildFrames } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import { distortion } from '@/core/warnings'

describe('distortion warning', () => {
  it.each([
    ['tetrahedron', 27, 'severe'],
    ['cube', 3 * Math.sqrt(3), 'moderate'],
    ['octahedron', 3 * Math.sqrt(3), 'moderate'],
    ['dodecahedron', 1.9928, 'low'],
    ['icosahedron', 1.9928, 'low'],
  ] as const)('%s: %f× areal, %s', (id: PresetId, areal, level) => {
    const d = distortion(buildFrames(preset(id)))
    expect(d.areal).toBeCloseTo(areal, 3)
    expect(d.level).toBe(level)
  })

  it('tetrahedron radial scale is 9× (the figure quoted in plan §5)', () => {
    expect(distortion(buildFrames(preset('tetrahedron'))).radial).toBeCloseTo(9, 9)
  })

  it('truncated icosahedron is the gentlest preset', () => {
    const d = distortion(buildFrames(preset('truncated-icosahedron')))
    expect(d.areal).toBeLessThan(1.4)
    expect(d.level).toBe('low')
  })
})
