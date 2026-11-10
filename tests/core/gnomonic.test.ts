import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { type FaceFrame, buildFrames, planePoint } from '@/core/polyhedron/faces'
import { PRESET_IDS, icosahedron, preset } from '@/core/polyhedron/presets'
import { gnomonic, inverseGnomonic, surfacePoint } from '@/core/project/gnomonic'
import { conjugate, rotate } from '@/core/quat'
import { type Vec2, type Vec3, cross, dot, length, lerp, negate, normalize, sub } from '@/core/vec3'

import { rotation, unitVec3, vecCloseTo } from '../arbitraries'

const frames = buildFrames(icosahedron())
const faceIndex = fc.integer({ min: 0, max: frames.faces.length - 1 })
const unitInterval = fc.double({ min: 0, max: 1, noNaN: true })

/** Random point inside a (triangular) face, in plane coordinates. */
const pointInFace = (face: FaceFrame) =>
  fc.tuple(unitInterval, unitInterval).map(([s, t]): Vec2 => {
    const [a, b, c] = face.vertices2D as [Vec2, Vec2, Vec2]
    // Fold the unit square onto the triangle.
    const [u, v] = s + t > 1 ? [1 - s, 1 - t] : [s, t]
    return [
      a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]),
      a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]),
    ]
  })

const shoelace = (pts: readonly Vec2[]) =>
  pts.reduce((s, [x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length]!
    return s + x0 * y1 - x1 * y0
  }, 0) / 2

describe('gnomonic projection', () => {
  it("projects each face's normal direction to the face origin", () => {
    for (const f of frames.faces) {
      expect(vecCloseTo(gnomonic(f, f.normal)!, [0, 0], 1e-15)).toBe(true)
    }
  })

  it('returns null behind the face plane', () => {
    for (const f of frames.faces) expect(gnomonic(f, negate(f.normal))).toBeNull()
  })

  it('round-trips plane points through the sphere', () => {
    fc.assert(
      fc.property(
        faceIndex.chain((i) =>
          fc.tuple(fc.constant(frames.faces[i]!), pointInFace(frames.faces[i]!)),
        ),
        ([face, xy]) => vecCloseTo(gnomonic(face, inverseGnomonic(face, xy))!, xy, 1e-12),
      ),
    )
  })

  it('edge continuity: shared-edge points map to the same 3D point from both faces (1e-9)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: frames.edges.length - 1 }), unitInterval, (e, t) => {
        const edge = frames.edges[e]!
        const P = lerp(frames.def.vertices[edge.a]!, frames.def.vertices[edge.b]!, t)
        const dir = normalize(P)
        return edge.faces.every((f) => {
          const face = frames.faces[f]!
          return vecCloseTo(planePoint(face, gnomonic(face, dir)!), P, 1e-9)
        })
      }),
    )
  })

  it('points on vertices/edges after globe rotation land on the face outline', () => {
    fc.assert(
      fc.property(rotation, faceIndex, fc.nat(2), unitInterval, (q, fi, k, t) => {
        const face = frames.faces[fi]!
        const n = face.vertices.length
        const P = lerp(face.vertices[k % n]!, face.vertices[(k + 1) % n]!, t)
        // A map point that the rotation q carries onto the edge point's direction.
        const mapPoint = rotate(conjugate(q), normalize(P))
        const xy = gnomonic(face, rotate(q, mapPoint))!
        const a = face.vertices2D[k % n]!
        const b = face.vertices2D[(k + 1) % n]!
        const expected: Vec2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
        return vecCloseTo(xy, expected, 1e-9)
      }),
    )
  })

  it('total projected face area equals the polyhedron surface area', () => {
    let projected = 0
    let surface = 0
    for (const f of frames.faces) {
      projected += shoelace(f.vertices.map((p) => gnomonic(f, normalize(p))!))
      for (let i = 1; i + 1 < f.vertices.length; i++) {
        const v0 = f.vertices[0]!
        surface += length(cross(sub(f.vertices[i]!, v0), sub(f.vertices[i + 1]!, v0))) / 2
      }
    }
    expect(projected).toBeCloseTo(surface, 12)
    expect(surface).toBeCloseTo(5 * Math.sqrt(3), 12) // 20 equilateral unit triangles
  })

  it('maps great-circle arcs to straight lines', () => {
    fc.assert(
      fc.property(
        faceIndex.chain((i) =>
          fc.tuple(
            fc.constant(frames.faces[i]!),
            pointInFace(frames.faces[i]!),
            pointInFace(frames.faces[i]!),
            unitInterval,
          ),
        ),
        ([face, xa, xb, t]) => {
          const a = inverseGnomonic(face, xa)
          const b = inverseGnomonic(face, xb)
          // Any point of the arc a→b is a positive combination of a and b.
          const m: Vec3 = normalize(lerp(a, b, t))
          const xm = gnomonic(face, m)!
          const crossZ = (xb[0] - xa[0]) * (xm[1] - xa[1]) - (xb[1] - xa[1]) * (xm[0] - xa[0])
          return Math.abs(crossZ) < 1e-12
        },
      ),
    )
  })
})

describe('surfacePoint (the live GPU preview formula)', () => {
  it.each(PRESET_IDS)('%s: matches gnomonic projection onto the containing face', (id) => {
    const fr = buildFrames(preset(id))
    fc.assert(
      fc.property(unitVec3, (p) => {
        const face = fr.faces.find((f) => f.edgePlanes.every((n) => dot(n, p) >= 0))!
        return vecCloseTo(surfacePoint(fr.faces, p), planePoint(face, gnomonic(face, p)!), 1e-9)
      }),
    )
  })
})
