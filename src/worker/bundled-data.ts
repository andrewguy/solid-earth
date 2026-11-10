import type { Topology } from 'topojson-specification'

export type SimplifiableTopology = Parameters<typeof presimplify>[0]
import { presimplify, quantile, simplify, sphericalTriangleArea } from 'topojson-simplify'

import type { Resolution } from '@/core/settings'

import type { MapSources } from './projector'

type Json = Promise<{ default: unknown }>
type Raw = [unknown, unknown, unknown, unknown]
const NAMES = ['land', 'countries', 'lakes', 'rivers'] as const

// 110m and 50m are bundled as dynamic-import chunks, fetched only when first used.
const bundled: Record<'110m' | '50m', () => Promise<Raw>> = {
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

export class MissingDataError extends Error {
  override name = 'MissingDataError'
}

/** 1:10m is too big to bundle: fetched from the site's static assets (public/data). */
async function fetch10m(): Promise<Raw> {
  const base = import.meta.env.BASE_URL
  return (await Promise.all(
    NAMES.map(async (name) => {
      const url = `${base}data/${name}-10m.topo.json`
      const res = await fetch(url)
      if (!res.ok) {
        throw new MissingDataError(
          `1:10m data is not available (${url}: ${res.status}). ` +
            'Run "npm run build:data" to generate it.',
        )
      }
      return res.json() as Promise<unknown>
    }),
  )) as Raw
}

/** Raw and presimplified 10m topologies, kept once fetched (presimplify is the slow part). */
let tenM: Promise<SimplifiableTopology[]> | null = null

/**
 * Keep roughly `detail` (0–1) of each topology's points, dropping the least significant first
 * by spherical triangle area (Visvalingam). Topologies are simplified independently.
 */
export function simplified(
  topologies: readonly SimplifiableTopology[],
  detail: number,
): Topology[] {
  if (detail >= 1) return [...topologies]
  return topologies.map((t) => simplify(t, quantile(t, detail)))
}

/** Load map data for a resolution (10m simplified to `detail`). */
export async function loadBundledData(resolution: Resolution, detail = 1): Promise<MapSources> {
  let raw: Raw
  if (resolution === '10m') {
    tenM ??= fetch10m().then((ts) =>
      ts.map((t) => presimplify(t as SimplifiableTopology, sphericalTriangleArea)),
    )
    tenM.catch(() => (tenM = null))
    raw = simplified(await tenM, detail) as unknown as Raw
  } else {
    raw = await bundled[resolution]()
  }
  const [land, countries, lakes, rivers] = raw
  return { land, countries, lakes, rivers } as MapSources
}
