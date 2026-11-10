/**
 * Output layers and their laser settings (plan §3, §6.4).
 * LightBurn assigns layers by exact stroke colour, so colours must be exact palette values.
 */

export const LIGHTBURN_COLORS = {
  '00': '#000000',
  '01': '#0000FF',
  '02': '#FF0000',
  '03': '#00E000',
} as const

export type LayerId =
  'cut' | 'coastlines' | 'borders' | 'rivers' | 'lakes' | 'land' | 'ocean' | 'graticule'

/** Map layers drawn as strokes from shared arcs. */
export type LineLayerId = 'coastlines' | 'borders'

export interface LayerStyle {
  readonly label: string
  readonly enabled: boolean
  /** Stroke colour; must be a LightBurn palette value. */
  readonly color: string
}

export const DEFAULT_LAYER_STYLES: Readonly<Record<LayerId, LayerStyle>> = {
  cut: { label: 'Cut', enabled: true, color: LIGHTBURN_COLORS['02'] },
  coastlines: { label: 'Coastlines', enabled: true, color: LIGHTBURN_COLORS['00'] },
  borders: { label: 'Borders', enabled: true, color: LIGHTBURN_COLORS['00'] },
  rivers: { label: 'Rivers', enabled: false, color: LIGHTBURN_COLORS['00'] },
  lakes: { label: 'Lakes', enabled: false, color: LIGHTBURN_COLORS['01'] },
  land: { label: 'Land', enabled: false, color: LIGHTBURN_COLORS['01'] },
  ocean: { label: 'Ocean', enabled: false, color: LIGHTBURN_COLORS['01'] },
  graticule: { label: 'Graticule', enabled: false, color: LIGHTBURN_COLORS['03'] },
}
