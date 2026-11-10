import type { LayerId, LayerStyle, LineLayerId } from '../layers'
import type { FaceArtwork } from '../pipeline'
import type { Vec2 } from '../vec3'

export interface SvgOptions {
  readonly marginMm: number
  /** Nominal stroke width; LightBurn ignores it for line mode (plan §6.5). */
  readonly strokeMm: number
  readonly styles: Readonly<Record<LayerId, LayerStyle>>
}

export const DEFAULT_SVG_OPTIONS: Omit<SvgOptions, 'styles'> = { marginMm: 1, strokeMm: 0.1 }

/** Engrave layers first, cut last, so the cut sits on top when viewed. */
const LINE_LAYER_ORDER: readonly LineLayerId[] = ['coastlines', 'borders']

/** Format a coordinate with at most 2 decimals and no trailing zeros. */
const fmt = (x: number) => {
  const s = x.toFixed(2).replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Serialise one face to SVG in real millimetres (plan §6.5): `width="…mm"` with a matching
 * viewBox so 1 user unit = 1 mm. The face frame is y-up; SVG is y-down, so y is flipped, which
 * keeps the artwork as seen from outside the solid. One Inkscape layer group per output layer.
 */
export function faceToSvg(art: FaceArtwork, options: SvgOptions): string {
  const { marginMm, strokeMm, styles } = options
  const xs = art.outline.map((p) => p[0])
  const ys = art.outline.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxY = Math.max(...ys)
  const width = Math.max(...xs) - minX + 2 * marginMm
  const height = maxY - Math.min(...ys) + 2 * marginMm

  const tx = ([x, y]: Vec2) => `${fmt(x - minX + marginMm)} ${fmt(maxY - y + marginMm)}`
  const pathData = (pts: readonly Vec2[], closed: boolean) =>
    `M${pts.map(tx).join('L')}${closed ? 'Z' : ''}`

  const group = (id: LayerId, d: string) => {
    const style = styles[id]
    return (
      `  <g id="layer-${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(style.label)}">\n` +
      `    <path d="${d}" fill="none" stroke="${style.color}" stroke-width="${fmt(strokeMm)}" ` +
      `stroke-linecap="round" stroke-linejoin="round"/>\n` +
      `  </g>\n`
    )
  }

  let body = ''
  for (const id of LINE_LAYER_ORDER) {
    const layer = art.layers[id]
    if (!styles[id].enabled || !layer || layer.polylines.length === 0) continue
    body += group(id, layer.polylines.map((pl) => pathData(pl, false)).join(''))
  }
  if (styles.cut.enabled) body += group('cut', pathData(art.outline, true))

  const w = fmt(width)
  const h = fmt(height)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
    body +
    `</svg>\n`
  )
}
