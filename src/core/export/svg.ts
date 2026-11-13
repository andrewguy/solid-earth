import {
  FILL_LAYERS,
  FILL_SHORES,
  type LayerId,
  type LayerStyle,
  LINE_LAYERS,
  fills,
  strokes,
} from '../layers'
import type { NestLayout, NestPlacement, NestSettings, RotationMode } from '../nest/types'
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

/** Maps an artwork point (mm, y up) to SVG user units (mm, y down). */
type ToSvg = (p: Vec2) => Vec2

/**
 * The path elements of one panel's artwork, per output layer, through `toSvg`. Fill paths also
 * carry a stroke of the same colour so LightBurn's colour-based layer assignment picks them up;
 * in a Fill layer LightBurn fills the closed shape. Layers with nothing to draw are absent.
 */
function layerPaths(
  art: FaceArtwork,
  styles: Readonly<Record<LayerId, LayerStyle>>,
  strokeMm: number,
  toSvg: ToSvg,
): Partial<Record<LayerId, string>> {
  const tx = (p: Vec2) => {
    const [x, y] = toSvg(p)
    return `${fmt(x)} ${fmt(y)}`
  }
  const pathData = (pts: readonly Vec2[], closed: boolean) =>
    `M${pts.map(tx).join('L')}${closed ? 'Z' : ''}`
  const sw = fmt(strokeMm)
  const strokePath = (d: string, color: string) =>
    `    <path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>\n`
  const fillPath = (d: string, color: string) =>
    `    <path d="${d}" fill="${color}" fill-rule="evenodd" stroke="${color}" ` +
    `stroke-width="${sw}" stroke-linejoin="round"/>\n`
  const linesD = (lines: readonly Vec2[][] | undefined) =>
    (lines ?? []).map((pl) => pathData(pl, false)).join('')

  const out: Partial<Record<LayerId, string>> = {}
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
    if (content) out[id] = content
  }
  for (const id of LINE_LAYERS) {
    const style = styles[id]
    const d = linesD(art.lines[id])
    if (style.enabled && d) out[id] = strokePath(d, style.color)
  }
  if (styles.starHoles.enabled && art.holes && art.holes.length > 0) {
    out.starHoles = strokePath(
      art.holes.map((h) => pathData(h, true)).join(''),
      styles.starHoles.color,
    )
  }
  if (styles.guide.enabled && art.guide) {
    out.guide = strokePath(pathData(art.guide, true), styles.guide.color)
  }
  if (styles.cut.enabled) out.cut = strokePath(pathData(art.cutOutline, true), styles.cut.color)
  return out
}

/**
 * Output layers in engraving order: fills, then lines, the sanding guide, star holes (cut before
 * the outline, plan §15.2), and the cut on top.
 */
const LAYER_ORDER: readonly LayerId[] = [
  ...FILL_LAYERS,
  ...LINE_LAYERS,
  'guide',
  'starHoles',
  'cut',
]

const layerGroup = (id: string, label: string, content: string) =>
  `  <g id="layer-${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(label)}">\n` +
  content +
  `  </g>\n`

const svgDocument = (width: number, height: number, body: string) => {
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

/**
 * Serialise one face to SVG in real millimetres (plan §6.5): `width="…mm"` with a matching
 * viewBox so 1 user unit = 1 mm. The face frame is y-up; SVG is y-down, so y is flipped, which
 * keeps the artwork as seen from outside the solid. One Inkscape layer group per output layer,
 * in engraving order: fills, then lines, then the cut on top.
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
  const paths = layerPaths(art, styles, strokeMm, ([x, y]) => [
    x - minX + marginMm,
    maxY - y + marginMm,
  ])
  let body = ''
  for (const id of LAYER_ORDER) {
    const content = paths[id]
    if (content) body += layerGroup(id, styles[id].label, content)
  }
  return svgDocument(width, height, body)
}

/**
 * LightBurn's T1 tool layer: never output to the laser (plan §13.1 Sheet outline). LightBurn only
 * imports onto tool layers with "Allow importing to Tool Layers" enabled; otherwise it uses the
 * nearest palette colour.
 */
export const SHEET_OUTLINE_COLOR = '#F36926'
export const SHEET_OUTLINE_LABEL = 'Sheet outline (T1, not cut)'

export interface SheetSvgOptions {
  readonly strokeMm: number
  readonly styles: Readonly<Record<LayerId, LayerStyle>>
  /** Draw the sheet boundary on its own tool layer. */
  readonly outline: boolean
}

/**
 * Sheet transform for a placed panel, artwork (export frame, mm, y up) → SVG (mm, y down). The
 * placement is relative to the panel's reference frame: its face frame in free rotation mode
 * (undo the artwork's export rotation first), its north-up export frame otherwise (plan §13.3).
 * The y flip matches `faceToSvg`, so panels read as seen from outside, never mirrored.
 */
export function placedToSvg(
  placement: NestPlacement,
  artRotation: number,
  mode: RotationMode,
  sheetHeightMm: number,
): ToSvg {
  const angle = placement.angleDeg * (Math.PI / 180) - (mode === 'free' ? artRotation : 0)
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  return ([x, y]) => [c * x - sn * y + placement.x, sheetHeightMm - (sn * x + c * y + placement.y)]
}

/**
 * One sheet of a nesting layout as an SVG in real millimetres (plan §13.4 step 8): every panel
 * placed on it, merged into one Inkscape layer group per output layer in engraving order, plus
 * the sheet outline on a tool layer. `arts` is indexed by face.
 */
export function sheetToSvg(
  arts: readonly FaceArtwork[],
  layout: NestLayout,
  sheet: number,
  nest: NestSettings,
  options: SheetSvgOptions,
): string {
  const { strokeMm, styles } = options
  const W = nest.sheetWidthMm
  const H = nest.sheetHeightMm
  const merged: Partial<Record<LayerId, string>> = {}
  for (const placement of layout.placements) {
    if (placement.sheet !== sheet) continue
    const art = arts[placement.face]
    if (!art) throw new Error(`no artwork for face ${placement.face}`)
    const toSvg = placedToSvg(placement, art.rotation, nest.rotationMode, H)
    const paths = layerPaths(art, styles, strokeMm, toSvg)
    for (const id of LAYER_ORDER) {
      if (paths[id]) merged[id] = (merged[id] ?? '') + paths[id]
    }
  }
  let body = ''
  if (options.outline) {
    body += layerGroup(
      'sheet',
      SHEET_OUTLINE_LABEL,
      `    <path d="M0 0L${fmt(W)} 0L${fmt(W)} ${fmt(H)}L0 ${fmt(H)}Z" fill="none" ` +
        `stroke="${SHEET_OUTLINE_COLOR}" stroke-width="${fmt(strokeMm)}"/>\n`,
    )
  }
  for (const id of LAYER_ORDER) {
    const content = merged[id]
    if (content) body += layerGroup(id, styles[id].label, content)
  }
  return svgDocument(W, H, body)
}

/** Every sheet of a layout, in order. */
export function sheetSvgs(
  arts: readonly FaceArtwork[],
  layout: NestLayout,
  nest: NestSettings,
  options: SheetSvgOptions,
): string[] {
  return Array.from({ length: layout.sheetCount }, (_, i) =>
    sheetToSvg(arts, layout, i, nest, options),
  )
}
