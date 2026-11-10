import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYER_STYLES } from '@/core/layers'
import { buildFrames } from '@/core/polyhedron/faces'
import { PRESET_IDS, preset } from '@/core/polyhedron/presets'
import { canvasSize, drawFaceTexture, faceUv } from '@/ui/three/texture'
import type { PackedFace } from '@/worker/projector'

/** Minimal 2D context that records path points. */
function recordingContext(width: number, height: number) {
  const points: [number, number][] = []
  const ctx = {
    canvas: { width, height },
    clearRect() {},
    fillRect() {},
    beginPath() {},
    stroke() {},
    moveTo: (x: number, y: number) => points.push([x, y]),
    lineTo: (x: number, y: number) => points.push([x, y]),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points }
}

describe('face texture mapping', () => {
  it.each(PRESET_IDS)('%s: each vertex is drawn at its own UV (no flips or mirroring)', (id) => {
    const frames = buildFrames(preset(id))
    const mmPerUnit = 37.5
    for (const face of frames.faces) {
      // A polyline through the face's own vertices, in mm.
      const n = face.vertices2D.length
      const coords = new Float32Array(
        face.vertices2D.flatMap(([x, y]) => [x * mmPerUnit, y * mmPerUnit]),
      )
      const packed: PackedFace = {
        layers: { coastlines: { coords, starts: new Uint32Array([0, n]) } },
      }
      const [w, h] = canvasSize(face, 512)
      const { ctx, points } = recordingContext(w, h)
      drawFaceTexture(ctx, face, packed, mmPerUnit, DEFAULT_LAYER_STYLES)
      expect(points).toHaveLength(n)
      points.forEach(([px, py], i) => {
        // CanvasTexture flips Y on upload: canvas row 0 is v = 1.
        const [u, v] = faceUv(face, face.vertices2D[i]!)
        expect(px / w).toBeCloseTo(u, 5)
        expect(1 - py / h).toBeCloseTo(v, 5)
      })
    }
  })

  it('keeps the canvas aspect ratio of the face', () => {
    const face = buildFrames(preset('icosahedron')).faces[0]!
    const [w, h] = canvasSize(face, 1024)
    expect(Math.max(w, h)).toBe(1024)
    expect(Math.min(w, h) / Math.max(w, h)).toBeCloseTo(Math.sqrt(3) / 2, 2)
  })
})
