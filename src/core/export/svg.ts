import {
  FILL_LAYERS,
  FILL_SHORES,
  type LayerId,
  type LayerStyle,
  LINE_LAYERS,
  fills,
  strokes,
} from '../layers'
import type { FaceArtwork } from '../pipeline'
import type { Vec2 } from '../vec3'

export interface SvgOptions {
  readonly marginMm: number
  /** Nominal stroke width; LightBurn ignores it for line mode (plan §6.5). */
  readonly strokeMm: number
  readonly styles: Readonly<Record<LayerId, LayerStyle>>
}

export const DEFAULT_SVG_OPTIONS: Omit<SvgOptions, 'styles'> = { marginMm: 1, strokeMm: 0.1 }

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
 * keeps the artwork as seen from outside the solid. One Inkscape layer group per output layer,
 * in engraving order: fills, then lines, then the cut on top.
 *
 * Fill paths also carry a stroke of the same colour so LightBurn's colour-based layer
 * assignment picks them up; in a Fill layer LightBurn fills the closed shape.
 */
export function faceToSvg(art: FaceArtwork, options: SvgOptions): string {
  const { marginMm, strokeMm, styles } = options
  // Bounds come from the cut path, which may be offset outward for kerf.
  const xs = art.cutOutline.map((p) => p[0])
  const ys = art.cutOutline.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxY = Math.max(...ys)
  const width = Math.max(...xs) - minX + 2 * marginMm
  const height = maxY - Math.min(...ys) + 2 * marginMm

  const tx = ([x, y]: Vec2) => `${fmt(x - minX + marginMm)} ${fmt(maxY - y + marginMm)}`
  const pathData = (pts: readonly Vec2[], closed: boolean) =>
    `M${pts.map(tx).join('L')}${closed ? 'Z' : ''}`
  const sw = fmt(strokeMm)

  const strokePath = (d: string, color: string) =>
    `    <path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>\n`
  const fillPath = (d: string, color: string) =>
    `    <path d="${d}" fill="${color}" fill-rule="evenodd" stroke="${color}" ` +
    `stroke-width="${sw}" stroke-linejoin="round"/>\n`
  const group = (id: LayerId, content: string) =>
    content
      ? `  <g id="layer-${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(styles[id].label)}">\n` +
        content +
        `  </g>\n`
      : ''
  const linesD = (lines: readonly Vec2[][] | undefined) =>
    (lines ?? []).map((pl) => pathData(pl, false)).join('')

  let body = ''
  for (const id of FILL_LAYERS) {
    const style = styles[id]
    if (!style.enabled) continue
    let content = ''
    const rings = art.fills[id]
    if (fills(style) && rings && rings.length > 0) {
      content += fillPath(rings.map((r) => pathData(r, true)).join(''), style.color)
    }
    const shores = linesD(art.lines[FILL_SHORES[id]])
    if (strokes(style) && shores) content += strokePath(shores, style.color)
    body += group(id, content)
  }
  for (const id of LINE_LAYERS) {
    const style = styles[id]
    const d = linesD(art.lines[id])
    if (style.enabled && d) body += group(id, strokePath(d, style.color))
  }
  if (styles.cut.enabled)
    body += group('cut', strokePath(pathData(art.cutOutline, true), styles.cut.color))

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
