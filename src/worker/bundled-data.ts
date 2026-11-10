import type { Resolution } from '@/core/settings'

import type { MapSources } from './projector'

// Dynamic imports so each resolution is its own chunk, fetched only when first used.
const loaders: Record<Resolution, () => Promise<[{ default: unknown }, { default: unknown }]>> = {
  '110m': () =>
    Promise.all([import('@/data/land-110m.topo.json'), import('@/data/countries-110m.topo.json')]),
  '50m': () =>
    Promise.all([import('@/data/land-50m.topo.json'), import('@/data/countries-50m.topo.json')]),
}

/** Load the bundled world-atlas TopoJSON for a resolution. */
export async function loadBundledData(resolution: Resolution): Promise<MapSources> {
  const [land, countries] = await loaders[resolution]()
  return { land: land.default, countries: countries.default } as MapSources
}
