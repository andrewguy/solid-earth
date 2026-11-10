import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { lonLatToVec3, vec3ToLonLat } from '@/core/geo/lonlat'
import { IDENTITY, conjugate, fromAxisAngle, multiply, rotate } from '@/core/quat'
import { type Vec3, angle, cross, dot, length } from '@/core/vec3'

import { closeTo, rotation, unitVec3, vecCloseTo } from '../arbitraries'

describe('vec3', () => {
  it('cross product is perpendicular to both inputs', () => {
    fc.assert(
      fc.property(unitVec3, unitVec3, (a, b) => {
        const c = cross(a, b)
        return closeTo(dot(c, a), 0, 1e-12) && closeTo(dot(c, b), 0, 1e-12)
      }),
    )
  })

  it('angle is stable at 0 and π', () => {
    expect(angle([1, 0, 0], [1, 0, 0])).toBe(0)
    expect(angle([1, 0, 0], [-1, 0, 0])).toBeCloseTo(Math.PI, 15)
    expect(angle([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2, 15)
  })
})

describe('quat', () => {
  it('rotates +x by 90° about +z to +y (right-hand rule)', () => {
    const q = fromAxisAngle([0, 0, 1], Math.PI / 2)
    expect(vecCloseTo(rotate(q, [1, 0, 0]), [0, 1, 0], 1e-15)).toBe(true)
  })

  it('identity leaves vectors unchanged', () => {
    fc.assert(fc.property(unitVec3, (v) => vecCloseTo(rotate(IDENTITY, v), v, 0)))
  })

  it('preserves length and angles', () => {
    fc.assert(
      fc.property(rotation, unitVec3, unitVec3, (q, a, b) => {
        const ra = rotate(q, a)
        const rb = rotate(q, b)
        return closeTo(length(ra), 1, 1e-12) && closeTo(dot(ra, rb), dot(a, b), 1e-12)
      }),
    )
  })

  it('composes: rotate(a·b, v) = rotate(a, rotate(b, v))', () => {
    fc.assert(
      fc.property(rotation, rotation, unitVec3, (a, b, v) =>
        vecCloseTo(rotate(multiply(a, b), v), rotate(a, rotate(b, v)), 1e-12),
      ),
    )
  })

  it('conjugate inverts', () => {
    fc.assert(
      fc.property(rotation, unitVec3, (q, v) =>
        vecCloseTo(rotate(conjugate(q), rotate(q, v)), v, 1e-12),
      ),
    )
  })
})

describe('lon/lat', () => {
  it('maps reference points to the documented axes', () => {
    const cases: [number, number, Vec3][] = [
      [0, 0, [1, 0, 0]],
      [90, 0, [0, 1, 0]],
      [0, 90, [0, 0, 1]],
      [180, 0, [-1, 0, 0]],
    ]
    for (const [lon, lat, v] of cases)
      expect(vecCloseTo(lonLatToVec3(lon, lat), v, 1e-15)).toBe(true)
  })

  it('round-trips away from the poles', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -179.999, max: 180, noNaN: true }),
        fc.double({ min: -89.999, max: 89.999, noNaN: true }),
        (lon, lat) => vecCloseTo(vec3ToLonLat(lonLatToVec3(lon, lat)), [lon, lat], 1e-9),
      ),
    )
  })
})
