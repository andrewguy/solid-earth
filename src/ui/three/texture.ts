import { CanvasTexture, SRGBColorSpace } from 'three'

import {
  FILL_LAYERS,
  FILL_SHORES,
  type LayerId,
  type LayerStyle,
  LINE_LAYERS,
  type LineSourceId,
  fills,
  strokes,
} from '@/core/layers'
import type { FaceFrame } from '@/core/polyhedron/faces'
import type { PackedFace, PackedLayer } from '@/worker/projector'

/** Paper/plywood-ish panel colour for the preview. */
export const PANEL_COLOR = '#f3ece0'
/** Fills are drawn translucent so the panel still reads as material, not paint. */
const FILL_ALPHA = 0.45

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

/**
 * Texture density shared by every face of a solid (pixels per model unit): the largest face
 * gets `maxPx` on its longest side and smaller faces proportionally fewer. A common density
 * keeps line widths physically equal on faces of different sizes (e.g. a truncated cube's
 * triangles and octagons).
 */
export function texturePxPerUnit(faces: readonly FaceFrame[], maxPx: number): number {
  let extent = 0
  for (const f of faces) {
    const { width, height } = faceBounds(f)
    extent = Math.max(extent, width, height)
  }
  return maxPx / extent
}

/** Base preview line width in pixels for textures drawn at `maxPx` for the largest face. */
export const baseLinePx = (maxPx: number) => Math.max(1, maxPx / 500)

/** Canvas pixel size for a face at `pxPerUnit`, aspect preserved. */
export function canvasSize(face: FaceFrame, pxPerUnit: number): [number, number] {
  const { width, height } = faceBounds(face)
  return [Math.max(1, Math.round(width * pxPerUnit)), Math.max(1, Math.round(height * pxPerUnit))]
}

/**
 * Draw one face's artwork into a canvas whose extent is the face's bounding box (plan §6.6:
 * the texture shows exactly what gets exported). Canvas y is down; plane y is up.
 * UVs are (x − minX)/width, (y − minY)/height, which matches with CanvasTexture's flipY.
 * Order matches the SVG: fills, then lines.
 */
export function drawFaceTexture(
  ctx: CanvasRenderingContext2D,
  face: FaceFrame,
  packed: PackedFace | undefined,
  mmPerUnit: number,
  styles: Readonly<Record<LayerId, LayerStyle>>,
  /** Line width in pixels at preview width 1×; the same for every face of a solid. */
  linePx: number,
): void {
  const { width: W, height: H } = ctx.canvas
  const { minX, minY, width, height } = faceBounds(face)
  const sx = W / width
  const sy = H / height

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = PANEL_COLOR
  ctx.fillRect(0, 0, W, H)
  if (!packed) return

  // Artwork is in the panel's export orientation (e.g. north-up); undo that rotation and the
  // mm scale to get back to the face frame the texture is laid out in.
  const c = Math.cos(packed.rotation) / mmPerUnit
  const s = Math.sin(packed.rotation) / mmPerUnit
  const trace = ({ coords, starts }: PackedLayer, closed: boolean) => {
    ctx.beginPath()
    for (let i = 0; i + 1 < starts.length; i++) {
      for (let k = starts[i]!; k < starts[i + 1]!; k++) {
        const ox = coords[2 * k]!
        const oy = coords[2 * k + 1]!
        const x = (c * ox + s * oy - minX) * sx
        const y = H - (-s * ox + c * oy - minY) * sy
        if (k === starts[i]) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      if (closed) ctx.closePath()
    }
  }
  const stroke = (source: LineSourceId, style: LayerStyle) => {
    const layer = packed.lines[source]
    if (!layer) return
    trace(layer, false)
    ctx.strokeStyle = style.color
    ctx.lineWidth = linePx * style.previewWidth
    ctx.stroke()
  }

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const id of FILL_LAYERS) {
    const style = styles[id]
    if (!style.enabled) continue
    const rings = packed.fills[id]
    if (fills(style) && rings) {
      trace(rings, true)
      ctx.globalAlpha = FILL_ALPHA
      ctx.fillStyle = style.color
      ctx.fill('evenodd')
      ctx.globalAlpha = 1
    }
    if (strokes(style)) stroke(FILL_SHORES[id], style)
  }
  for (const id of LINE_LAYERS) if (styles[id].enabled) stroke(id, styles[id])
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

  /** Redraw at the solid's shared texture density and flag the texture for upload. */
  update(
    face: FaceFrame,
    packed: PackedFace | undefined,
    mmPerUnit: number,
    styles: Readonly<Record<LayerId, LayerStyle>>,
    pxPerUnit: number,
    linePx: number,
    anisotropy: number,
  ): void {
    const [w, h] = canvasSize(face, pxPerUnit)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.texture.dispose() // GPU storage must be reallocated at the new size
    }
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    drawFaceTexture(ctx, face, packed, mmPerUnit, styles, linePx)
    this.texture.anisotropy = anisotropy
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }
}
