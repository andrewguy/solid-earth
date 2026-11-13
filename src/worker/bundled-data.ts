import type { SkyData } from '@/core/geo/sky'
import type { Resolution } from '@/core/settings'

import type { MapSources } from './projector'

type Json = Promise<{ default: unknown }>
type Raw = [unknown, unknown, unknown, unknown]

// Dynamic imports so each resolution is its own set of chunks, fetched only when first used.
const loaders: Record<Resolution, () => Promise<Raw>> = {
  '110m': () =>
    Promise.all<Json[]>([
      import('@/data/land-110m.topo.json'),
      import('@/data/countries-110m.topo.json'),
      import('@/data/lakes-110m.topo.json'),
      import('@/data/rivers-110m.topo.json'),
    ]).then((ms) => ms.map((m) => m.default) as Raw),
  '50m': () =>
    Promise.all<Json[]>([
      import('@/data/land-50m.topo.json'),
      import('@/data/countries-50m.topo.json'),
      import('@/data/lakes-50m.topo.json'),
      import('@/data/rivers-50m.topo.json'),
    ]).then((ms) => ms.map((m) => m.default) as Raw),
}

/** Load the bundled TopoJSON for a resolution. */
export async function loadBundledData(resolution: Resolution): Promise<MapSources> {
  const [land, countries, lakes, rivers] = await loaders[resolution]()
  return { land, countries, lakes, rivers } as MapSources
}

/** Load the bundled sky (plan §15.3), as its own chunk fetched only when the sky is first shown. */
export async function loadSkyData(): Promise<SkyData> {
  const m = (await import('@/data/sky.json')) as { default: unknown }
  return m.default as SkyData
}
