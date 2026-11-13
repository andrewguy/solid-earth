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
 *  - d3-celestial (npm, pinned in package.json): stars to magnitude 6, constellation lines and
 *    the outermost Milky Way outline, packed into sky.json (plan §15.3).
 *
 * Winding: polygon rings are normalised to the d3 / world-atlas spherical convention
 * (exterior rings clockwise, i.e. enclosing the smaller area). See plan §4.2.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import {
  FillRule,
  area as areaClipper,
  intersect as intersectClipper,
  union as unionClipper,
} from 'clipper2-ts'
import { geoArea, geoContains, geoEquirectangular, geoStream } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
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

const r4 = (x: number) => Math.round(x * 1e4) / 1e4
const pos = (p: Position): Position => [r4(p[0]!), r4(p[1]!)]

/** Galactic centre and anticentre (J2000 RA/Dec as lon/lat): only the full band holds both. */
const GALACTIC_CENTRE: [number, number] = [-93.6, -29.0]
const GALACTIC_ANTICENTRE: [number, number] = [86.4, 28.9]

/**
 * The sky (plan §15.3): stars as flat [lon, lat, mag] triples sorted brightest first, constellation
 * stick figures as polylines, and the outermost of the five nested Milky Way outlines as polygons.
 * The outermost level is the one containing both the galactic centre and anticentre (not assumed
 * from its id). The band wraps the whole sky, so the small-exterior rewinding used for lakes would
 * turn it inside out; its rings are oriented by containment instead (`orientByContainment`). Longitude is right ascension in
 * degrees (d3-celestial stores 12–24 h as −180…0°), latitude is declination, epoch J2000.
 */
/**
 * Orient every ring of `geometry` so the region lies on its right in lon/lat (y up), the d3
 * convention. Membership is taken from `geoContains`, whose even-odd test ignores ring direction:
 * the published Milky Way relies on it and has one band edge running the other way, which a
 * winding-based fill (ours, and `geoArea`) reads as the band's complement. Each ring is tested at
 * a few of its edges and the majority decides.
 */
function orientByContainment(geometry: Polygon | MultiPolygon): Position[][][] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const region = { type: 'MultiPolygon', coordinates: polygons } as MultiPolygon
  const rightIsInside = (ring: Position[], k: number) => {
    const a = ring[k]!
    const b = ring[(k + 1) % ring.length]!
    let dx = b[0]! - a[0]!
    if (dx > 180) dx -= 360
    else if (dx < -180) dx += 360
    const dy = b[1]! - a[1]!
    const len = Math.hypot(dx, dy)
    if (len === 0) return null
    const step = Math.min(0.01, len / 10)
    const mid = [a[0]! + dx / 2, a[1]! + dy / 2]
    return geoContains(region, [mid[0]! + (dy / len) * step, mid[1]! - (dx / len) * step])
  }
  return polygons.map((rings) =>
    rings.map((ring) => {
      let votes = 0
      for (let i = 0; i < 9; i++) {
        const inside = rightIsInside(ring, Math.floor(((i + 0.5) * (ring.length - 1)) / 9))
        if (inside !== null) votes += inside ? 1 : -1
      }
      return votes >= 0 ? ring : [...ring].reverse()
    }),
  )
}

/** Lon/lat → Clipper integers (1e-5° ≈ 1 m on the sky; far below any engraving detail). */
const TILE_SCALE = 1e5
const TILE_DEG = 30
/** Smallest tile piece kept, in square degrees. */
const MIN_TILE_AREA_DEG2 = 1e-3

/**
 * Cut a region into small lon/lat tiles, each ring wound the d3 way (exterior clockwise, holes
 * counter-clockwise in lon/lat with y up).
 *
 * The pipeline clips polygons on the sphere with Sutherland–Hodgman, which joins a ring's exit
 * and entry points along the shorter great-circle arc. That needs rings well within a hemisphere:
 * the Milky Way's edges wrap right round the sky, so a cone plane cuts them at nearly opposite
 * points and the join can go either way, filling the wrong side or nothing (plan §15.6). Small
 * tiles keep every ring short; the per-panel 2D union merges neighbouring tiles back together.
 *
 * d3's equirectangular projection (scale 180/π, no resampling) does the antimeridian and pole
 * cutting, giving planar lon/lat rings; Clipper then intersects them with a 30° grid.
 */
function tileRegion(region: MultiPolygon): Position[][][] {
  const rings: Position[][] = []
  let ring: Position[] = []
  const projection = geoEquirectangular()
    .scale(180 / Math.PI)
    .translate([0, 0])
    .precision(0)
  const stream = projection.stream({
    point: (x: number, y: number) => ring.push([x, -y]), // d3's y is down
    lineStart: () => (ring = []),
    lineEnd: () => rings.push(ring),
    polygonStart: () => {},
    polygonEnd: () => {},
    sphere: () => {},
  })
  geoStream(region, stream)

  const toPath = (r: Position[]) =>
    r.map(([x, y]) => ({ x: Math.round(x! * TILE_SCALE), y: Math.round(y! * TILE_SCALE) }))
  // Even-odd: d3's output rings are for a non-zero canvas fill in y-down coordinates, so their
  // orientation here is not to be trusted, but they never overlap.
  const planar = unionClipper(rings.map(toPath), FillRule.EvenOdd)

  const tiles: Position[][][] = []
  for (let lon = -180; lon < 180; lon += TILE_DEG) {
    for (let lat = -90; lat < 90; lat += TILE_DEG) {
      const cell = toPath([
        [lon, lat],
        [lon + TILE_DEG, lat],
        [lon + TILE_DEG, lat + TILE_DEG],
        [lon, lat + TILE_DEG],
      ])
      // Drop slivers where the band grazes a grid line: d3 reads a near-zero-area ring as
      // (almost) the whole sphere.
      const pieces = intersectClipper(planar, [cell], FillRule.NonZero).filter(
        (p) => Math.abs(areaClipper(p)) > MIN_TILE_AREA_DEG2 * TILE_SCALE ** 2,
      )
      if (pieces.length === 0) continue
      // Clipper: exteriors counter-clockwise (y up), holes clockwise, rings open. d3 wants the
      // reverse winding, and GeoJSON rings closed (d3 misreads an open ring's area).
      tiles.push(
        pieces.map((p) => {
          const ring = p.map(({ x, y }) => [r4(x / TILE_SCALE), r4(y / TILE_SCALE)] as Position)
          ring.reverse()
          return [...ring, ring[0]!]
        }),
      )
    }
  }
  return tiles
}

async function buildSky(): Promise<void> {
  const pkgJson = require.resolve('d3-celestial/package.json')
  const dataDir = path.join(path.dirname(pkgJson), 'data')
  const { version } = JSON.parse(await readFile(pkgJson, 'utf8')) as { version: string }
  const read = async (file: string) =>
    JSON.parse(await readFile(path.join(dataDir, file), 'utf8')) as FeatureCollection

  const starFeatures = (await read('stars.6.json')).features
    .flatMap((f) => {
      const mag = Number((f.properties as { mag?: unknown } | null)?.mag)
      return f.geometry?.type === 'Point' && Number.isFinite(mag)
        ? [{ p: f.geometry.coordinates, mag }]
        : []
    })
    .sort((a, b) => a.mag - b.mag)
  const stars = starFeatures.flatMap(({ p, mag }) => [
    r4(p[0]!),
    r4(p[1]!),
    Math.round(mag * 100) / 100,
  ])

  const constellations = (await read('constellations.lines.json')).features.flatMap((f) =>
    f.geometry?.type === 'MultiLineString'
      ? f.geometry.coordinates.map((line) => line.map(pos))
      : f.geometry?.type === 'LineString'
        ? [f.geometry.coordinates.map(pos)]
        : [],
  )

  const levels = (await read('mw.json')).features.filter(
    (f): f is Feature<Polygon | MultiPolygon> =>
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
  )
  const full = levels.filter(
    (f) => geoContains(f, GALACTIC_CENTRE) && geoContains(f, GALACTIC_ANTICENTRE),
  )
  if (full.length !== 1) {
    throw new Error(`expected one Milky Way level around the whole sky, found ${full.length}`)
  }
  const outer = full[0]!
  const band: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: orientByContainment(outer.geometry),
  }
  // The band covers about a sixth of the sky (≈ 2.1 sr); a winding mistake gives far less or more.
  const checkArea = (what: string, g: MultiPolygon) => {
    const area = geoArea(g)
    if (!(area > 1.5 && area < 2.7)) {
      throw new Error(`Milky Way ${what} area ${area.toFixed(2)} sr is implausible`)
    }
    return area
  }
  const bandArea = checkArea('band', band)
  const milkyWay = tileRegion(band)
  const tileArea = checkArea('tiles', { type: 'MultiPolygon', coordinates: milkyWay })
  if (Math.abs(tileArea - bandArea) > 0.01 * bandArea) {
    throw new Error(
      `Milky Way tiles cover ${tileArea.toFixed(3)} sr, the band ${bandArea.toFixed(3)}`,
    )
  }
  // The outline, for stroking, keeps the original rings: line clipping has no such limit.
  const milkyWayEdges = band.coordinates.flatMap((rings) => rings.map((ring) => ring.map(pos)))

  const dest = path.join(OUT_DIR, 'sky.json')
  await writeFile(dest, JSON.stringify({ stars, constellations, milkyWay, milkyWayEdges }))
  console.log(
    `d3-celestial@${version}  ${path.relative(ROOT, dest)}  (${starFeatures.length} stars, ` +
      `${constellations.length} constellation lines, Milky Way level ${String(outer.id)} in ` +
      `${milkyWay.length} tiles)`,
  )
}

async function main(): Promise<void> {
  const skipNaturalEarth = process.argv.includes('--skip-natural-earth')
  await mkdir(OUT_DIR, { recursive: true })
  await buildWorldAtlas()
  await buildSky()
  if (skipNaturalEarth) console.log('skipping Natural Earth lakes/rivers')
  else await buildNaturalEarth()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
