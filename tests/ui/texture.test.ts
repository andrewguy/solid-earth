import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYER_STYLES } from '@/core/layers'
import { buildFrames } from '@/core/polyhedron/faces'
import { PRESET_IDS, preset } from '@/core/polyhedron/presets'
import {
  canvasSize,
  drawFaceTexture,
  faceBounds,
  faceUv,
  texturePxPerUnit,
} from '@/ui/three/texture'
import type { PackedFace } from '@/worker/projector'

/** Minimal 2D context that records path points. */
function recordingContext(width: number, height: number) {
  const points: [number, number][] = []
  const ctx = {
    canvas: { width, height },
    lineWidth: 1,
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
        rotation: 0,
        lines: { coastlines: { coords, starts: new Uint32Array([0, n]) } },
        fills: {},
      }
      const [w, h] = canvasSize(face, texturePxPerUnit(frames.faces, 512))
      const { ctx, points } = recordingContext(w, h)
      drawFaceTexture(ctx, face, packed, mmPerUnit, DEFAULT_LAYER_STYLES, 2)
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
    const frames = buildFrames(preset('icosahedron'))
    const face = frames.faces[0]!
    const [w, h] = canvasSize(face, texturePxPerUnit(frames.faces, 1024))
    expect(Math.max(w, h)).toBe(1024)
    expect(Math.min(w, h) / Math.max(w, h)).toBeCloseTo(Math.sqrt(3) / 2, 2)
  })
  it.each(PRESET_IDS)('%s: lines are the same physical width on every face', (id) => {
    const frames = buildFrames(preset(id))
    const pxPerUnit = texturePxPerUnit(frames.faces, 1024)
    const widths = frames.faces.map((face) => {
      const [w, h] = canvasSize(face, pxPerUnit)
      const packed: PackedFace = {
        rotation: 0,
        lines: {
          coastlines: { coords: new Float32Array([0, 0, 1, 1]), starts: new Uint32Array([0, 2]) },
        },
        fills: {},
      }
      const { ctx } = recordingContext(w, h)
      drawFaceTexture(ctx, face, packed, 1, DEFAULT_LAYER_STYLES, 2)
      // Line width in model units = pixels / actual pixels per unit of this canvas.
      const { width } = faceBounds(face)
      return ctx.lineWidth / (w / width)
    })
    // Equal up to canvas-size rounding (≤ 1 px on the smallest face).
    const max = Math.max(...widths)
    const min = Math.min(...widths)
    expect((max - min) / max).toBeLessThan(0.02)
    // The largest face gets the full resolution.
    const largest = Math.max(...frames.faces.map((f) => Math.max(...canvasSize(f, pxPerUnit))))
    expect(largest).toBe(1024)
  })
})
