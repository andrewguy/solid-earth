/**
 * Output layers and their laser settings (plan §3, §6.4).
 * LightBurn assigns layers by exact colour, so colours must be exact palette values.
 */

/** LightBurn's layer palette, index 00–29. */
export const LIGHTBURN_PALETTE = [
  '#000000',
  '#0000FF',
  '#FF0000',
  '#00E000',
  '#D0D000',
  '#FF8000',
  '#00E0E0',
  '#FF00FF',
  '#B4B4B4',
  '#0000A0',
  '#A00000',
  '#00A000',
  '#A0A000',
  '#C08000',
  '#00A0FF',
  '#A000A0',
  '#808080',
  '#7D87B9',
  '#BB7784',
  '#4A6FE3',
  '#D33F6A',
  '#8CD78C',
  '#F0B98D',
  '#F6C4E1',
  '#FA9ED4',
  '#500A78',
  '#B45A00',
  '#004754',
  '#86FA88',
  '#FFDB66',
] as const

export type LightBurnColor = (typeof LIGHTBURN_PALETTE)[number]

/** "00"–"29" for a palette colour, or null if it is not one. */
export function lightBurnIndex(color: string): string | null {
  const i = (LIGHTBURN_PALETTE as readonly string[]).indexOf(color.toUpperCase())
  return i < 0 ? null : String(i).padStart(2, '0')
}

/** Layers drawn as strokes: Earth linework, the sky's lines (plan §15) and the Moon's (§16). */
export type LineLayerId =
  | 'coastlines'
  | 'borders'
  | 'rivers'
  | 'graticule'
  | 'skyGrid'
  | 'ecliptic'
  | 'constellations'
  | 'moonGrid'
  | 'craters'
/**
 * Layers that can be filled and optionally stroked: Earth's land, lakes and ocean (stroked along
 * their shorelines), the Milky Way and the Moon's maria (stroked along their outlines) and stars
 * (dots, or rings).
 */
export type FillLayerId =
  'land' | 'lakes' | 'ocean' | 'milkyWay' | 'stars' | 'maria' | 'craterShadows'
/**
 * `guide` is the sanding guide, output only for sanded bevel joints (plan §14). `starHoles` are
 * stars cut right through the panel (plan §15).
 */
export type LayerId = 'cut' | 'guide' | 'starHoles' | LineLayerId | FillLayerId

/**
 * Linework sources prepared from the data. Fill layers never stroke their clipped polygon
 * outlines (that would engrave along every cut, plan §5); "stroke" mode draws their shoreline
 * arcs instead.
 */
export type LineSourceId =
  LineLayerId | 'lakeShores' | 'milkyWayEdge' | 'starRings' | 'mariaEdge' | 'craterShadowEdge'

/** Engraving order within each kind: lower layers first. */
export const LINE_LAYERS: readonly LineLayerId[] = [
  'graticule',
  'rivers',
  'borders',
  'coastlines',
  'skyGrid',
  'ecliptic',
  'constellations',
  'moonGrid',
  'craters',
]
export const FILL_LAYERS: readonly FillLayerId[] = [
  'ocean',
  'land',
  'lakes',
  'milkyWay',
  'stars',
  'maria',
  'craterShadows',
]

/** Outline linework a fill layer strokes in "stroke"/"both" mode. */
export const FILL_SHORES: Readonly<Record<FillLayerId, LineSourceId>> = {
  land: 'coastlines',
  ocean: 'coastlines',
  lakes: 'lakeShores',
  milkyWay: 'milkyWayEdge',
  stars: 'starRings',
  maria: 'mariaEdge',
  craterShadows: 'craterShadowEdge',
}

/** What the panels show (plan §15, §16). */
export type Subject = 'earth' | 'sky' | 'moon'
export const SUBJECTS: readonly Subject[] = ['earth', 'sky', 'moon']

/** Layers that belong to one subject; `cut` and `guide` belong to both. */
export const SUBJECT_LAYERS: Readonly<Record<Subject, readonly LayerId[]>> = {
  earth: ['coastlines', 'borders', 'rivers', 'lakes', 'land', 'ocean', 'graticule'],
  sky: ['stars', 'starHoles', 'constellations', 'milkyWay', 'skyGrid', 'ecliptic'],
  moon: ['maria', 'craters', 'craterShadows', 'moonGrid'],
}

/** True if `id` is drawn for `subject`. */
export const layerInSubject = (id: LayerId, subject: Subject) =>
  id === 'cut' || id === 'guide' || SUBJECT_LAYERS[subject].includes(id)

/**
 * The styles with every layer of the other subject switched off, so nothing from it is computed
 * or exported.
 */
export function subjectStyles(
  styles: Readonly<Record<LayerId, LayerStyle>>,
  subject: Subject,
): Record<LayerId, LayerStyle> {
  const out = { ...styles }
  for (const id of Object.keys(out) as LayerId[]) {
    if (!layerInSubject(id, subject) && out[id].enabled) out[id] = { ...out[id], enabled: false }
  }
  return out
}

export type LayerMode = 'stroke' | 'fill' | 'both'

export interface LayerStyle {
  readonly label: string
  readonly enabled: boolean
  /** Must be a LightBurn palette colour. */
  readonly color: string
  /** Fill layers only; line layers and the cut are always "stroke". */
  readonly mode: LayerMode
  /** Line width multiplier for the on-screen preview only (exports use 0.1 mm). */
  readonly previewWidth: number
}

const [C00, C01, C02, C03, C04, C05, C06, C07] = LIGHTBURN_PALETTE

/** Defaults from plan §3. */
export const DEFAULT_LAYER_STYLES: Readonly<Record<LayerId, LayerStyle>> = {
  cut: { label: 'Cut', enabled: true, color: C02, mode: 'stroke', previewWidth: 1 },
  coastlines: { label: 'Coastlines', enabled: true, color: C00, mode: 'stroke', previewWidth: 1 },
  borders: { label: 'Country borders', enabled: true, color: C00, mode: 'stroke', previewWidth: 1 },
  rivers: { label: 'Rivers', enabled: false, color: C00, mode: 'stroke', previewWidth: 1 },
  lakes: { label: 'Lakes', enabled: false, color: C01, mode: 'fill', previewWidth: 1 },
  land: { label: 'Land', enabled: false, color: C01, mode: 'fill', previewWidth: 1 },
  ocean: { label: 'Ocean', enabled: false, color: C01, mode: 'fill', previewWidth: 1 },
  graticule: { label: 'Graticule', enabled: false, color: C03, mode: 'stroke', previewWidth: 1 },
  guide: { label: 'Sanding guide', enabled: true, color: C04, mode: 'stroke', previewWidth: 1 },
  stars: { label: 'Stars', enabled: true, color: C06, mode: 'fill', previewWidth: 1 },
  starHoles: { label: 'Star holes', enabled: false, color: C05, mode: 'stroke', previewWidth: 1 },
  constellations: {
    label: 'Constellation lines',
    enabled: true,
    color: C00,
    mode: 'stroke',
    previewWidth: 1,
  },
  milkyWay: { label: 'Milky Way', enabled: false, color: C01, mode: 'fill', previewWidth: 1 },
  skyGrid: { label: 'Celestial grid', enabled: false, color: C03, mode: 'stroke', previewWidth: 1 },
  ecliptic: {
    label: 'Ecliptic & equator',
    enabled: false,
    color: C03,
    mode: 'stroke',
    previewWidth: 1,
  },
  // Maria default to their outline: a full fill is a long engrave (plan §16.2).
  maria: { label: 'Maria', enabled: true, color: C01, mode: 'stroke', previewWidth: 1 },
  craters: { label: 'Craters', enabled: true, color: C00, mode: 'stroke', previewWidth: 1 },
  moonGrid: { label: 'Lunar grid', enabled: false, color: C03, mode: 'stroke', previewWidth: 1 },
  // Its own colour, so LightBurn can engrave shadows at a different power (plan §16.8).
  craterShadows: {
    label: 'Crater shadows',
    enabled: true,
    color: C07,
    mode: 'fill',
    previewWidth: 1,
  },
}

export const isFillLayer = (id: LayerId): id is FillLayerId =>
  (FILL_LAYERS as readonly string[]).includes(id)

export const fills = (style: LayerStyle) => style.mode === 'fill' || style.mode === 'both'
export const strokes = (style: LayerStyle) => style.mode === 'stroke' || style.mode === 'both'

/** Which fills the pipeline must compute for these styles (ocean and land need land). */
export function fillsNeeded(styles: Readonly<Record<LayerId, LayerStyle>>) {
  const on = (id: FillLayerId) => styles[id].enabled && fills(styles[id])
  return {
    land: on('land'),
    lakes: on('lakes'),
    ocean: on('ocean'),
    milkyWay: on('milkyWay'),
    stars: on('stars'),
    maria: on('maria'),
    craterShadows: on('craterShadows'),
  }
}
