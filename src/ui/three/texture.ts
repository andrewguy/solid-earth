import { CanvasTexture, SRGBColorSpace } from 'three'

import type { LayerId, LayerStyle, LineLayerId } from '@/core/layers'
import type { FaceFrame } from '@/core/polyhedron/faces'
import type { PackedFace } from '@/worker/projector'

/** Paper/plywood-ish panel colour for the preview. */
export const PANEL_COLOR = '#f3ece0'
const LINE_LAYERS: readonly LineLayerId[] = ['coastlines', 'borders']

/** Face bounds in plane coordinates (model units), used for both UVs and canvas mapping. */
export function faceBounds(face: FaceFrame) {
  const xs = face.vertices2D.map((p) => p[0])
  const ys = face.vertices2D.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

/** Texture coordinate of plane point (x, y): the face bounding box maps to the unit square. */
export function faceUv(face: FaceFrame, [x, y]: readonly [number, number]): [number, number] {
  const { minX, minY, width, height } = faceBounds(face)
  return [(x - minX) / width, (y - minY) / height]
}

/** Canvas pixel size for a face: longest side = `maxPx`, aspect preserved. */
export function canvasSize(face: FaceFrame, maxPx: number): [number, number] {
  const { width, height } = faceBounds(face)
  const k = maxPx / Math.max(width, height)
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))]
}

/**
 * Draw one face's artwork into a canvas whose extent is the face's bounding box (plan §6.6:
 * the texture shows exactly what gets exported). Canvas y is down; plane y is up.
 * UVs are (x − minX)/width, (y − minY)/height, which matches with CanvasTexture's flipY.
 */
export function drawFaceTexture(
  ctx: CanvasRenderingContext2D,
  face: FaceFrame,
  packed: PackedFace | undefined,
  mmPerUnit: number,
  styles: Readonly<Record<LayerId, LayerStyle>>,
): void {
  const { width: W, height: H } = ctx.canvas
  const { minX, minY, width, height } = faceBounds(face)
  const sx = W / width
  const sy = H / height

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = PANEL_COLOR
  ctx.fillRect(0, 0, W, H)
  if (!packed) return

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1, Math.max(W, H) / 500)
  for (const id of LINE_LAYERS) {
    const layer = packed.layers[id]
    if (!layer || !styles[id].enabled) continue
    const { coords, starts } = layer
    ctx.strokeStyle = styles[id].color
    ctx.beginPath()
    for (let i = 0; i + 1 < starts.length; i++) {
      for (let k = starts[i]!; k < starts[i + 1]!; k++) {
        const x = (coords[2 * k]! / mmPerUnit - minX) * sx
        const y = H - (coords[2 * k + 1]! / mmPerUnit - minY) * sy
        if (k === starts[i]) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }
}

/**
 * A face's canvas plus the three.js texture that shows it. Owns its mutation so React
 * components only call methods.
 */
export class FaceCanvasTexture {
  readonly canvas = document.createElement('canvas')
  readonly texture = new CanvasTexture(this.canvas)

  constructor() {
    this.texture.colorSpace = SRGBColorSpace
  }

  /** Redraw at `maxPx` (longest side) and flag the texture for upload. */
  update(
    face: FaceFrame,
    packed: PackedFace | undefined,
    mmPerUnit: number,
    styles: Readonly<Record<LayerId, LayerStyle>>,
    maxPx: number,
    anisotropy: number,
  ): void {
    const [w, h] = canvasSize(face, maxPx)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.texture.dispose() // GPU storage must be reallocated at the new size
    }
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    drawFaceTexture(ctx, face, packed, mmPerUnit, styles)
    this.texture.anisotropy = anisotropy
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }
}
