import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { lonLatToVec3 } from '@/core/geo/lonlat'
import { rotationBetween, rotationReadout, topRotation } from '@/core/geo/rotation'
import { IDENTITY, fromAxisAngle, multiply, rotate } from '@/core/quat'

import { closeTo, rotation, unitVec3, vecCloseTo } from '../arbitraries'

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

describe('rotationReadout', () => {
  it('reads identity as north pole on top, no roll', () => {
    const r = rotationReadout(IDENTITY)
    expect(r.lat).toBeCloseTo(90, 12)
    expect(r.roll).toBeCloseTo(0, 12)
  })

  it('topRotation puts the chosen point on top', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -179, max: 180, noNaN: true }),
        fc.double({ min: -89, max: 89, noNaN: true }),
        (lon, lat) =>
          vecCloseTo(rotate(topRotation(lon, lat), lonLatToVec3(lon, lat)), [0, 0, 1], 1e-12),
      ),
    )
  })

  it('recovers lon, lat and roll away from the poles', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -179, max: 180, noNaN: true }),
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -179, max: 180, noNaN: true }),
        (lon, lat, roll) => {
          const q = multiply(
            fromAxisAngle([0, 0, 1], (roll * Math.PI) / 180),
            topRotation(lon, lat),
          )
          const r = rotationReadout(q)
          return (
            angleDiff(r.lon, lon) < 1e-7 &&
            closeTo(r.lat, lat, 1e-7) &&
            angleDiff(r.roll, roll) < 1e-7
          )
        },
      ),
    )
  })
})

describe('rotationBetween', () => {
  it('maps from onto to, including opposite vectors', () => {
    fc.assert(
      fc.property(unitVec3, unitVec3, (a, b) =>
        vecCloseTo(rotate(rotationBetween(a, b), a), b, 1e-9),
      ),
    )
    expect(
      vecCloseTo(rotate(rotationBetween([1, 0, 0], [-1, 0, 0]), [1, 0, 0]), [-1, 0, 0], 1e-12),
    ).toBe(true)
  })

  it('is a valid rotation (preserves other vectors’ length)', () => {
    fc.assert(
      fc.property(unitVec3, unitVec3, rotation, (a, b, q) => {
        const v = rotate(q, [1, 0, 0])
        const r = rotate(rotationBetween(a, b), v)
        return closeTo(Math.hypot(...r), 1, 1e-9)
      }),
    )
  })
})
