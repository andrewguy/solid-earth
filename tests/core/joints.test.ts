import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { prepareLines } from '@/core/geo/lines'
import { graticuleLines } from '@/core/geo/topojson'
import {
  type FingerParams,
  type FingerTip,
  faceFingers,
  fingerParams,
  fingerProfile,
  fingeredOutline,
} from '@/core/joints'
import { ringArea } from '@/core/planar/clipper'
import { buildAllFaces, longestEdge, prepareMap } from '@/core/pipeline'
import { type PolyhedronFrames, buildFrames, planePoint } from '@/core/polyhedron/faces'
import { type PresetId, preset } from '@/core/polyhedron/presets'
import { type Vec2, type Vec3, add, cross, dot, normalize, scale, sub } from '@/core/vec3'

import { vecCloseTo } from '../arbitraries'

const DEG = Math.PI / 180

/** Area of the intersection of two convex CCW polygons (Sutherland–Hodgman). */
function convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): number {
  let out: Vec2[] = [...a]
  b.forEach((p, k) => {
    const q = b[(k + 1) % b.length]!
    const side = ([x, y]: Vec2) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    const input = out
    out = []
    input.forEach((s, i) => {
      const e = input[(i + 1) % input.length]!
      const ds = side(s)
      const de = side(e)
      if (ds >= 0) out.push(s)
      if (ds >= 0 !== de >= 0) {
        const r = ds / (ds - de)
        out.push([s[0] + r * (e[0] - s[0]), s[1] + r * (e[1] - s[1])])
      }
    })
  })
  return out.length >= 3 ? Math.abs(ringArea(out)) : 0
}

/** Cross-section of an edge: panel A's finger and panel B's notched body (plan §12.4 item 1). */
function crossSection(theta: number, t: number, tip: number, notch: number) {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  // A frame (s, z) and B frame (s', z') → common 2D: true edge at the origin.
  const fromA = (sA: number, z: number): Vec2 => [-sA, -z]
  const fromB = (sB: number, z: number): Vec2 => [-sB * c - z * s, -sB * s + z * c]
  const toB = ([x, y]: Vec2) => ({ s: -c * x - s * y, z: -s * x + c * y })
  const far = 20 * t
  const rect = (from: (a: number, b: number) => Vec2, lo: number) => {
    const r = [from(lo, 0), from(lo, t), from(lo + far, t), from(lo + far, 0)]
    return ringArea(r) < 0 ? r.reverse() : r
  }
  return { finger: rect(fromA, tip), body: rect(fromB, notch), fromA, fromB, toB }
}

const tips: FingerTip[] = ['fill', 'flush']

describe('finger cross-section', () => {
  const dihedral = fc.double({ min: 20 * DEG, max: 165 * DEG, noNaN: true })

  it.each(tips)(
    '%s: finger and notch never overlap, and the notch is as shallow as possible',
    (tip) => {
      fc.assert(
        fc.property(dihedral, (theta) => {
          const prof = fingerProfile(theta, 1, tip, 0)
          const x = crossSection(theta, 1, prof.tip, prof.notch)
          const tight = crossSection(theta, 1, prof.tip, prof.notch - 1e-3)
          return (
            convexOverlap(x.finger, x.body) < 1e-9 && convexOverlap(tight.finger, tight.body) > 0
          )
        }),
      )
    },
  )

  it('flush: no part of the finger crosses the neighbour’s outer surface', () => {
    fc.assert(
      fc.property(dihedral, (theta) => {
        const prof = fingerProfile(theta, 1, 'flush', 0)
        const x = crossSection(theta, 1, prof.tip, prof.notch)
        return x.finger.every((p) => x.toB(p).z >= -1e-12)
      }),
    )
  })

  /**
   * Length of the neighbour's outer surface, from the true edge to the notch, that the finger
   * does not cover (after sanding protruding tips flush with that surface).
   */
  function outerGap(theta: number, tip: number, notch: number): number {
    const x = crossSection(theta, 1, tip, notch)
    const steps = 2000
    let gap = 0
    for (let i = 0; i < steps; i++) {
      const sB = (notch * (i + 0.5)) / steps
      const [px, py] = x.fromB(sB, 0)
      const covered = -py >= 0 && -py <= 1 && -px >= tip
      if (!covered) gap += notch / steps
    }
    return gap
  }

  it('fill: the outer surface closes up at obtuse and right-angled joints', () => {
    fc.assert(
      fc.property(fc.double({ min: 90 * DEG, max: 165 * DEG, noNaN: true }), (theta) => {
        const prof = fingerProfile(theta, 1, 'fill', 0)
        const x = crossSection(theta, 1, prof.tip, prof.notch)
        // The finger's end face lies at or outside the neighbour's outer plane…
        const endFace = [x.fromA(prof.tip, 0), x.fromA(prof.tip, 1)]
        // …so it covers the neighbour's outer surface from the true edge up to the notch.
        return (
          endFace.every((p) => x.toB(p).z <= 1e-12) && outerGap(theta, prof.tip, prof.notch) === 0
        )
      }),
    )
  })

  it('fill: at acute joints a gap of t·cot θ stays open (square cuts cannot close it)', () => {
    fc.assert(
      fc.property(fc.double({ min: 30 * DEG, max: 85 * DEG, noNaN: true }), (theta) => {
        const prof = fingerProfile(theta, 1, 'fill', 0)
        const expected = 1 / Math.tan(theta)
        return Math.abs(outerGap(theta, prof.tip, prof.notch) - expected) < 2e-3 * (1 + prof.notch)
      }),
    )
  })

  it('is an ordinary box joint at 90°', () => {
    for (const tip of tips) {
      const prof = fingerProfile(90 * DEG, 3, tip, 0)
      expect(prof.tip).toBeCloseTo(0, 12)
      expect(prof.notch).toBeCloseTo(3, 12)
    }
  })

  it('obtuse closed forms: notch t·sin θ (flush), t / sin θ (fill)', () => {
    const theta = 138.19 * DEG
    expect(fingerProfile(theta, 3, 'flush', 0).notch).toBeCloseTo(3 * Math.sin(theta), 12)
    expect(fingerProfile(theta, 3, 'fill', 0).notch).toBeCloseTo(3 / Math.sin(theta), 12)
    expect(fingerProfile(theta, 3, 'fill', 0.1).notch).toBeCloseTo(3 / Math.sin(theta) + 0.1, 12)
  })
})

/** Signed distance from p to a simple polygon's boundary: positive inside. */
function signedDistance(poly: readonly Vec2[], [x, y]: Vec2): number {
  let inside = false
  let best = Infinity
  poly.forEach(([ax, ay], k) => {
    const [bx, by] = poly[(k + 1) % poly.length]!
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
    const ex = bx - ax
    const ey = by - ay
    const r = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)))
    best = Math.min(best, Math.hypot(x - ax - r * ex, y - ay - r * ey))
  })
  return inside ? best : -best
}

/** The (u, v) plane coordinates of a 3D point projected onto a face plane. */
function toPlane(frames: PolyhedronFrames, f: number, p: Vec3): { xy: Vec2; depth: number } {
  const face = frames.faces[f]!
  const r = sub(p, scale(face.normal, face.distance))
  return { xy: [dot(r, face.u), dot(r, face.v)], depth: -dot(r, face.normal) }
}

const CASES: { id: PresetId; tip: FingerTip; clearanceMm: number }[] = [
  { id: 'cube', tip: 'fill', clearanceMm: 0 },
  { id: 'tetrahedron', tip: 'fill', clearanceMm: 0.1 },
  { id: 'tetrahedron', tip: 'flush', clearanceMm: 0 },
  { id: 'icosahedron', tip: 'fill', clearanceMm: 0 },
  { id: 'icosahedron', tip: 'flush', clearanceMm: 0.1 },
  { id: 'truncated-icosahedron', tip: 'fill', clearanceMm: 0.1 },
  { id: 'rhombic-triacontahedron', tip: 'flush', clearanceMm: 0 },
  { id: 'snub-cube', tip: 'fill', clearanceMm: 0.1 },
]

function setup(id: PresetId, tip: FingerTip, clearanceMm: number, widthMm = 10) {
  const frames = buildFrames(preset(id))
  const mmPerUnit = 100 / longestEdge(frames)
  const p = fingerParams({ widthMm, tip, clearanceMm }, 3, mmPerUnit)
  const outlines = frames.faces.map((f) => fingeredOutline(frames, f.index, p))
  return { frames, mmPerUnit, p, outlines }
}

/** Points filling face f's fingers (finger segments past the butt inset), in 3D. */
function fingerSamples(frames: PolyhedronFrames, f: number, p: FingerParams): Vec3[] {
  const face = frames.faces[f]!
  const loop = face.vertexIndices
  const out: Vec3[] = []
  faceFingers(frames, f, p).forEach((lay, k) => {
    if (lay.count === 0) return
    const dihedral = frames.edges.find(
      (e) =>
        (e.a === loop[k] && e.b === loop[(k + 1) % loop.length]) ||
        (e.b === loop[k] && e.a === loop[(k + 1) % loop.length]),
    )!.dihedral
    const prof = fingerProfile(dihedral, p.thickness, p.tip, p.clearance)
    const p0 = face.vertices2D[k]!
    const p1 = face.vertices2D[(k + 1) % loop.length]!
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const e: Vec2 = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len]
    const n: Vec2 = [-e[1], e[0]]
    const forward = loop[k]! < loop[(k + 1) % loop.length]!
    for (let i = 0; i < lay.count; i += 2) {
      const j = forward ? i : lay.count - 1 - i
      const lo = lay.start + j * lay.width
      const [u0, u1] = forward
        ? [lo, lo + lay.width]
        : [lay.length - lo - lay.width, lay.length - lo]
      const d = p.clearance
      for (let a = 0; a <= 4; a++) {
        const u = u0 + d + ((u1 - u0 - 2 * d) * a) / 4
        for (let b = 0; b <= 4; b++) {
          const w = prof.tip + ((prof.butt - prof.tip) * b) / 4
          for (let c = 0; c <= 2; c++) {
            const xy: Vec2 = [p0[0] + u * e[0] + w * n[0], p0[1] + u * e[1] + w * n[1]]
            out.push(add(planePoint(face, xy), scale(face.normal, (-p.thickness * c) / 2)))
          }
        }
      }
    }
  })
  return out
}

describe('fingered panels', () => {
  it.each(CASES)(
    '$id ($tip, clearance $clearanceMm mm): no finger enters any other panel',
    ({ id, tip, clearanceMm }) => {
      // Narrow fingers leave little leftover length, so some sit right at the corner clearance.
      for (const widthMm of [10, 2.3]) checkNoCollisions(setup(id, tip, clearanceMm, widthMm))
    },
  )

  function checkNoCollisions({ frames, p, outlines }: ReturnType<typeof setup>) {
    let fingered = 0
    const eps = 1e-7
    for (const face of frames.faces) {
      const samples = fingerSamples(frames, face.index, p)
      fingered += samples.length
      for (const q of samples) {
        for (const other of frames.faces) {
          if (other.index === face.index) continue
          const { xy, depth } = toPlane(frames, other.index, q)
          const inside =
            depth > eps &&
            depth < p.thickness - eps &&
            signedDistance(outlines[other.index]!, xy) > eps
          if (inside) {
            throw new Error(`face ${face.index} finger point is inside face ${other.index}`)
          }
        }
      }
    }
    expect(fingered).toBeGreaterThan(0)
  }

  it.each(CASES)('$id ($tip): outlines are simple polygons', ({ id, tip, clearanceMm }) => {
    const { outlines } = setup(id, tip, clearanceMm)
    for (const outline of outlines) {
      // A self-intersecting outline would have non-adjacent edges crossing.
      const n = outline.length
      expect(ringArea(outline)).toBeGreaterThan(0)
      for (let i = 0; i < n; i++) {
        const [a, b] = [outline[i]!, outline[(i + 1) % n]!]
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue
          const [c, d] = [outline[j]!, outline[(j + 1) % n]!]
          const o = (p: Vec2, q: Vec2, r: Vec2) =>
            (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
          const crosses = o(a, b, c) * o(a, b, d) < -1e-18 && o(c, d, a) * o(c, d, b) < -1e-18
          expect(crosses).toBe(false)
        }
      }
    }
  })

  it('every edge has an even number of segments, matching on both panels', () => {
    const { frames, p } = setup('truncated-icosahedron', 'fill', 0.1)
    const byEdge = new Map<string, number>()
    for (const face of frames.faces) {
      const loop = face.vertexIndices
      faceFingers(frames, face.index, p).forEach((lay, k) => {
        expect(lay.count % 2).toBe(0)
        const a = loop[k]!
        const b = loop[(k + 1) % loop.length]!
        const key = a < b ? `${a}-${b}` : `${b}-${a}`
        const seen = byEdge.get(key)
        if (seen === undefined) byEdge.set(key, lay.count)
        else expect(lay.count).toBe(seen)
      })
    }
    expect(Math.max(...byEdge.values())).toBeGreaterThanOrEqual(4)
  })

  it('congruent faces get identical panels (Catalan solid)', () => {
    const { outlines } = setup('rhombic-triacontahedron', 'fill', 0.1)
    const signature = (o: Vec2[]) =>
      o.map((pt, k) => {
        const q = o[(k + 1) % o.length]!
        return Math.round(Math.hypot(q[0] - pt[0], q[1] - pt[1]) * 1e6)
      })
    const ref = signature(outlines[0]!)
    for (const o of outlines) {
      const sig = signature(o)
      const matches = sig.some((_, r) => sig.every((x, i) => x === ref[(i + r) % ref.length]))
      expect(sig.length).toBe(ref.length)
      expect(matches).toBe(true)
    }
  })

  it('edges too short for two fingers stay butt joints', () => {
    const frames = buildFrames(preset('icosahedron'))
    const p = fingerParams(
      { widthMm: 60, tip: 'fill', clearanceMm: 0.1 },
      3,
      100 / longestEdge(frames),
    )
    expect(faceFingers(frames, 0, p).every((l) => l.count === 0)).toBe(true)
  })
})

describe('fingered artwork', () => {
  const frames = buildFrames(preset('icosahedron'))
  const mmPerUnit = 100 / longestEdge(frames)
  const graticule = prepareLines(graticuleLines(5), 0.5, { keepSeams: true })
  const joint = { kind: 'finger', widthMm: 10, tip: 'fill', clearanceMm: 0.1 } as const
  const arts = buildAllFaces(frames, prepareMap({ graticule }), {
    mmPerUnit,
    precisionMm: null,
    thicknessMm: 3,
    joint,
    fills: { ocean: true },
    kerfMm: 0.2,
  })
  const p = fingerParams(joint, 3, mmPerUnit)

  it('cuts the fingered outline, kerf-offset outward', () => {
    for (const art of arts) {
      const expected = fingeredOutline(frames, art.faceIndex, p)
      expect(art.outline).toHaveLength(expected.length)
      art.outline.forEach((pt, k) => {
        const [x, y] = expected[k]!
        expect(vecCloseTo(pt, [x * mmPerUnit, y * mmPerUnit], 1e-9)).toBe(true)
      })
      expect(ringArea(art.cutOutline)).toBeGreaterThan(ringArea(art.outline))
    }
  })

  /** Signed distance (mm) from a point to the true face; negative = past its edge. */
  const trueFaceOf = (f: number) =>
    frames.faces[f]!.vertices2D.map(([x, y]): Vec2 => [x * mmPerUnit, y * mmPerUnit])

  it('engraves the whole cut shape, including finger tips past the true edge', () => {
    let pastEdge = 0
    for (const art of arts) {
      const trueFace = trueFaceOf(art.faceIndex)
      const lines = art.lines.graticule ?? []
      expect(lines.length).toBeGreaterThan(0)
      for (const pt of lines.flat()) {
        expect(signedDistance(art.outline, pt)).toBeGreaterThan(-2e-3)
        if (signedDistance(trueFace, pt) < -1) pastEdge++
      }
    }
    expect(pastEdge).toBeGreaterThan(0)
  })

  it('past the true edge, the map is the same gnomonic projection (great circles stay straight)', () => {
    // A great circle through face 0, crossing each of its edges.
    const face = frames.faces[0]!
    const circleNormal = normalize(cross(face.normal, face.u))
    const circle: Vec3[] = []
    for (let i = 0; i <= 720; i++) {
      const a = (i / 720) * 2 * Math.PI
      circle.push(
        add(scale(face.normal, Math.cos(a)), scale(cross(circleNormal, face.normal), Math.sin(a))),
      )
    }
    const [art] = buildAllFaces(frames, prepareMap({ coastlines: [circle] }), {
      mmPerUnit,
      precisionMm: null,
      thicknessMm: 3,
      joint,
    })
    const pts = (art!.lines.coastlines ?? []).flat()
    expect(pts.length).toBeGreaterThan(0)
    const trueFace = trueFaceOf(0)
    expect(Math.min(...pts.map((pt) => signedDistance(trueFace, pt)))).toBeLessThan(-1)
    for (const [x, y] of pts) {
      // Back to 3D on the face plane: the direction must lie on the great circle.
      const dir = normalize(planePoint(face, [x / mmPerUnit, y / mmPerUnit]))
      expect(Math.abs(dot(dir, circleNormal))).toBeLessThan(1e-6)
    }
  })

  it('ocean with no land fills exactly the cut outline', () => {
    for (const art of arts) {
      const area = (art.fills.ocean ?? []).reduce((s, r) => s + ringArea(r), 0)
      expect(area).toBeCloseTo(ringArea(art.outline), 1)
    }
  })
})
