import { describe, expect, it } from 'vitest'

import { buildFrames, planePoint } from '@/core/polyhedron/faces'
import { convexHullFaces } from '@/core/polyhedron/hull'
import { icosahedron } from '@/core/polyhedron/presets'
import { type Vec3, cross, distance, dot, length, sub } from '@/core/vec3'

import { vecCloseTo } from '../arbitraries'

const PHI = (1 + Math.sqrt(5)) / 2

describe('icosahedron preset', () => {
  const def = icosahedron()
  const frames = buildFrames(def)

  it('has 12 vertices, 20 triangular faces and 30 edges', () => {
    expect(def.vertices).toHaveLength(12)
    expect(def.faces).toHaveLength(20)
    expect(frames.edges).toHaveLength(30)
    for (const f of def.faces) expect(f).toHaveLength(3)
  })

  it('has unit edge length everywhere', () => {
    for (const e of frames.edges) {
      expect(distance(def.vertices[e.a]!, def.vertices[e.b]!)).toBeCloseTo(1, 12)
    }
  })

  it('has every face at the inradius φ²/(2√3) with outward normals', () => {
    const inradius = (PHI * PHI) / (2 * Math.sqrt(3))
    for (const f of frames.faces) {
      expect(f.distance).toBeCloseTo(inradius, 12)
      const centroid = f.vertices.reduce<Vec3>(
        (a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]],
        [0, 0, 0],
      )
      expect(dot(centroid, f.normal)).toBeGreaterThan(0)
    }
  })

  it('has the regular dihedral angle arccos(−√5/3) ≈ 138.19°', () => {
    for (const e of frames.edges) expect(e.dihedral).toBeCloseTo(Math.acos(-Math.sqrt(5) / 3), 12)
  })

  it('has orthonormal right-handed face bases', () => {
    for (const f of frames.faces) {
      expect(length(f.u)).toBeCloseTo(1, 14)
      expect(dot(f.u, f.normal)).toBeCloseTo(0, 14)
      expect(vecCloseTo(cross(f.u, f.v), f.normal, 1e-14)).toBe(true)
    }
  })

  it('maps 2D face vertices back onto their 3D positions', () => {
    for (const f of frames.faces) {
      f.vertices2D.forEach((xy, i) => {
        expect(vecCloseTo(planePoint(f, xy), f.vertices[i]!, 1e-14)).toBe(true)
      })
    }
  })

  it('has 2D vertices CCW (positive signed area) as seen from outside', () => {
    for (const f of frames.faces) {
      const pts = f.vertices2D
      let area2 = 0
      pts.forEach(([x0, y0], i) => {
        const [x1, y1] = pts[(i + 1) % pts.length]!
        area2 += x0 * y1 - x1 * y0
      })
      expect(area2).toBeGreaterThan(0)
    }
  })

  it('has edge planes that contain the centre direction of the face', () => {
    for (const f of frames.faces) {
      for (const plane of f.edgePlanes) expect(dot(plane, f.normal)).toBeGreaterThan(0)
    }
  })
})

describe('convexHullFaces', () => {
  it('merges coplanar points into quads for a cube', () => {
    const cube: Vec3[] = []
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push([x, y, z])
    const faces = convexHullFaces(cube)
    expect(faces).toHaveLength(6)
    for (const f of faces) expect(f).toHaveLength(4)
    // CCW from outside: consecutive edge cross products point outward.
    for (const f of faces) {
      const [a, b, c] = f.map((i) => cube[i]!) as [Vec3, Vec3, Vec3]
      expect(dot(cross(sub(b, a), sub(c, b)), a)).toBeGreaterThan(0)
    }
    expect(() => buildFrames({ name: 'cube', vertices: cube, faces })).not.toThrow()
  })
})

describe('buildFrames validation', () => {
  it('rejects inward-wound faces', () => {
    const def = icosahedron()
    const flipped = { ...def, faces: def.faces.map((f) => [...f].reverse()) }
    expect(() => buildFrames(flipped)).toThrow(/origin is not strictly inside/)
  })
})
