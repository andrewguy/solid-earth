import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { clipPolylineToCone } from '@/core/clip/polyline'
import { buildFrames } from '@/core/polyhedron/faces'
import { icosahedron } from '@/core/polyhedron/presets'
import { inverseGnomonic } from '@/core/project/gnomonic'
import { rotate } from '@/core/quat'
import { type Vec2, type Vec3, angle, distance, dot, negate } from '@/core/vec3'

import { rotation, sphericalPolyline } from '../arbitraries'

const frames = buildFrames(icosahedron())
const face0 = frames.faces[0]!

const arcLength = (pts: readonly Vec3[]) =>
  pts.slice(1).reduce((s, p, i) => s + angle(pts[i]!, p), 0)

const insideCone = (planes: readonly Vec3[], p: Vec3, tol: number) =>
  planes.every((n) => dot(n, p) >= -tol)

const allEdgePlanes = frames.faces.flatMap((f) => f.edgePlanes)

/**
 * True if some segment lies (almost) in an edge plane. Such a segment runs along a shared
 * edge and legitimately belongs to both faces, so partition properties exclude it.
 */
const runsAlongAnEdge = (pts: readonly Vec3[]) =>
  pts
    .slice(1)
    .some((b, i) =>
      allEdgePlanes.some((n) => Math.abs(dot(n, pts[i]!)) < 1e-9 && Math.abs(dot(n, b)) < 1e-9),
    )

/** Ring in face 0's plane straddling edge 0 (crosses it twice, no other edge), starting inside. */
function ringAcrossEdge0(closed: boolean): Vec3[] {
  const [a, b, c] = face0.vertices2D as [Vec2, Vec2, Vec2]
  const g: Vec2 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const r = Math.hypot(g[0] - m[0], g[1] - m[1]) // inradius of the 2D triangle
  const toG: Vec2 = [(g[0] - m[0]) / r, (g[1] - m[1]) / r]
  const centre: Vec2 = [m[0] + 0.6 * r * toG[0], m[1] + 0.6 * r * toG[1]]
  const start = Math.atan2(toG[1], toG[0])
  const pts: Vec3[] = []
  for (let i = 0; i < 64; i++) {
    const t = start + (2 * Math.PI * i) / 64
    pts.push(
      inverseGnomonic(face0, [
        centre[0] + 0.8 * r * Math.cos(t),
        centre[1] + 0.8 * r * Math.sin(t),
      ]),
    )
  }
  if (closed) pts.push(pts[0]!)
  return pts
}

describe('clipPolylineToCone', () => {
  it('keeps a polyline that is fully inside unchanged', () => {
    const pts = [
      inverseGnomonic(face0, [0, 0]),
      inverseGnomonic(face0, [0.05, 0.02]),
      inverseGnomonic(face0, [0.1, -0.03]),
    ]
    const runs = clipPolylineToCone(pts, face0.edgePlanes)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toEqual(pts)
    expect(runs[0]![1]).toBe(pts[1]) // same objects, no recomputation
  })

  it('drops a polyline in the antipodal cone', () => {
    const pts = [inverseGnomonic(face0, [0, 0]), inverseGnomonic(face0, [0.1, 0.05])].map(negate)
    expect(clipPolylineToCone(pts, face0.edgePlanes)).toEqual([])
  })

  it('splits an open in-out-in polyline into two runs', () => {
    expect(clipPolylineToCone(ringAcrossEdge0(false), face0.edgePlanes)).toHaveLength(2)
  })

  it('rejoins a closed ring split at its start point', () => {
    const ring = ringAcrossEdge0(true)
    const inside = clipPolylineToCone(ring, face0.edgePlanes)
    expect(inside).toHaveLength(1)
    const neighbour = frames.edges.find(
      (e) =>
        e.faces.includes(0) &&
        [e.a, e.b].includes(face0.vertexIndices[0]!) &&
        [e.a, e.b].includes(face0.vertexIndices[1]!),
    )!
    const other = frames.faces[neighbour.faces.find((f) => f !== 0)!]!
    const outside = clipPolylineToCone(ring, other.edgePlanes)
    expect(outside).toHaveLength(1)
    expect(arcLength(inside[0]!) + arcLength(outside[0]!)).toBeCloseTo(arcLength(ring), 12)
  })

  it('outputs only points inside the cone', () => {
    fc.assert(
      fc.property(sphericalPolyline, (pts) =>
        frames.faces.every((f) =>
          clipPolylineToCone(pts, f.edgePlanes).every((run) =>
            run.every((p) => insideCone(f.edgePlanes, p, 1e-12)),
          ),
        ),
      ),
    )
  })

  it('conserves total arc length across all faces (faces partition the sphere)', () => {
    fc.assert(
      fc.property(sphericalPolyline, rotation, (raw, q) => {
        const pts = raw.map((p) => rotate(q, p))
        fc.pre(!runsAlongAnEdge(pts))
        const total = arcLength(pts)
        const clipped = frames.faces
          .flatMap((f) => clipPolylineToCone(pts, f.edgePlanes))
          .reduce((s, run) => s + arcLength(run), 0)
        return Math.abs(clipped - total) < 1e-9
      }),
    )
  })

  it('creates boundary points that coincide exactly with the neighbouring face', () => {
    fc.assert(
      fc.property(sphericalPolyline, rotation, (raw, q) => {
        const pts = raw.map((p) => rotate(q, p))
        fc.pre(!runsAlongAnEdge(pts))
        const original = new Set(pts)
        const cuts = frames.faces.map((f) =>
          clipPolylineToCone(pts, f.edgePlanes)
            .flatMap((run) => [run[0]!, run[run.length - 1]!])
            .filter((p) => !original.has(p)),
        )
        return cuts.every((own, fi) =>
          own.every((p) =>
            cuts.some((other, fj) => fj !== fi && other.some((o) => distance(o, p) < 1e-12)),
          ),
        )
      }),
    )
  })
})
