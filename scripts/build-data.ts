/**
 * Build the bundled map data in src/data/.
 *
 *   npm run build:data                      # everything
 *   npm run build:data -- --skip-natural-earth   # world-atlas only (no network)
 *
 * Sources:
 *  - world-atlas (npm, pinned in package.json): countries + land, already TopoJSON.
 *  - Natural Earth vector (GitHub, pinned tag): lakes + rivers GeoJSON, converted here.
 *    Downloads are cached in .cache/natural-earth/.
 *
 * Winding: polygon rings are normalised to the d3 / world-atlas spherical convention
 * (exterior rings clockwise, i.e. enclosing the smaller area). See plan §4.2.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { geoArea } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { topology } from 'topojson-server'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.join(ROOT, 'src/data')
const CACHE_DIR = path.join(ROOT, '.cache/natural-earth')

const NE_TAG = 'v5.1.2'
const NE_BASE_URL =
  process.env.NE_BASE_URL ??
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson`

const RESOLUTIONS = ['110m', '50m'] as const
type Resolution = (typeof RESOLUTIONS)[number]

/** Same quantisation as world-atlas. */
const QUANTIZATION = 1e5

const NE_LAYERS = {
  lakes: { file: (r: Resolution) => `ne_${r}_lakes.geojson`, keep: ['name', 'scalerank'] },
  rivers: {
    file: (r: Resolution) => `ne_${r}_rivers_lake_centerlines.geojson`,
    keep: ['name', 'scalerank', 'featurecla'],
  },
} as const

const require = createRequire(import.meta.url)

async function buildWorldAtlas(): Promise<void> {
  const pkgJson = require.resolve('world-atlas/package.json')
  const pkgDir = path.dirname(pkgJson)
  const { version } = JSON.parse(await readFile(pkgJson, 'utf8')) as { version: string }
  for (const res of RESOLUTIONS) {
    for (const layer of ['countries', 'land']) {
      const dest = path.join(OUT_DIR, `${layer}-${res}.topo.json`)
      await copyFile(path.join(pkgDir, `${layer}-${res}.json`), dest)
      console.log(`world-atlas@${version}  ${path.relative(ROOT, dest)}`)
    }
  }
}

async function fetchCached(file: string): Promise<string> {
  const cached = path.join(CACHE_DIR, NE_TAG, file)
  try {
    return await readFile(cached, 'utf8')
  } catch {
    // not cached yet
  }
  const url = `${NE_BASE_URL}/${file}`
  console.log(`fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  const text = await res.text()
  await mkdir(path.dirname(cached), { recursive: true })
  await writeFile(cached, text)
  return text
}

const HEMISPHERE = 2 * Math.PI

/** Rewind one polygon's rings to the d3 convention: exterior small, holes large. */
function rewindPolygon(rings: Position[][]): Position[][] {
  return rings.map((ring, i) => {
    const area = geoArea({ type: 'Polygon', coordinates: [ring] })
    const isExterior = i === 0
    const wrong = isExterior ? area > HEMISPHERE : area < HEMISPHERE
    return wrong ? [...ring].reverse() : ring
  })
}

function rewind(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case 'Polygon':
      return { ...geometry, coordinates: rewindPolygon(geometry.coordinates) }
    case 'MultiPolygon':
      return { ...geometry, coordinates: geometry.coordinates.map(rewindPolygon) }
    default:
      return geometry
  }
}

function pick(props: Record<string, unknown> | null, keys: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (props && props[k] != null) out[k] = props[k]
  return out
}

async function buildNaturalEarth(): Promise<void> {
  for (const res of RESOLUTIONS) {
    for (const [layer, spec] of Object.entries(NE_LAYERS)) {
      const raw = JSON.parse(await fetchCached(spec.file(res))) as FeatureCollection
      const features: Feature[] = raw.features
        .filter((f) => f.geometry != null)
        .map((f) => ({
          type: 'Feature',
          properties: pick(f.properties, spec.keep),
          geometry: rewind(f.geometry),
        }))
      const collection: FeatureCollection = { type: 'FeatureCollection', features }
      const topo = topology({ [layer]: collection }, QUANTIZATION)
      const dest = path.join(OUT_DIR, `${layer}-${res}.topo.json`)
      await writeFile(dest, JSON.stringify(topo))
      console.log(
        `natural-earth@${NE_TAG}  ${path.relative(ROOT, dest)}  (${features.length} features)`,
      )
    }
  }
}

async function main(): Promise<void> {
  const skipNaturalEarth = process.argv.includes('--skip-natural-earth')
  await mkdir(OUT_DIR, { recursive: true })
  await buildWorldAtlas()
  if (skipNaturalEarth) console.log('skipping Natural Earth lakes/rivers')
  else await buildNaturalEarth()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
