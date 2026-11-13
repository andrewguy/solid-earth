/**
 * Build the bundled map data in src/data/.
 *
 *   npm run build:data                      # everything
 *   npm run build:data -- --skip-natural-earth   # world-atlas only (no network)
 *   npm run build:data -- --moon-only            # the Moon only
 *
 * Sources:
 *  - world-atlas (npm, pinned in package.json): countries + land, already TopoJSON.
 *  - Natural Earth vector (GitHub, pinned tag): lakes + rivers GeoJSON, converted here.
 *    Downloads are cached in .cache/natural-earth/.
 *  - d3-celestial (npm, pinned in package.json): stars to magnitude 6, constellation lines and
 *    the outermost Milky Way outline, packed into sky.json (plan §15.3).
 *  - LROC global mare boundaries (NASA PDS) and the IAU/USGS Gazetteer of Planetary Nomenclature:
 *    maria and craters, packed into moon.json (plan §16.3). Downloads are cached in .cache/moon/.
 *
 * Winding: polygon rings are normalised to the d3 / world-atlas spherical convention
 * (exterior rings clockwise, i.e. enclosing the smaller area). See plan §4.2.
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import {
  ClipType,
  FillRule,
  type Path64,
  type Paths64,
  PolyPath64,
  PolyTree64,
  area as areaClipper,
  booleanOpWithPolyTree,
  intersect as intersectClipper,
  union as unionClipper,
} from 'clipper2-ts'
import { geoArea, geoContains, geoEquirectangular, geoStream } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import JSZip from 'jszip'
import { read as readShapefile } from 'shapefile'
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

// ---------------------------------------------------------------------------------------------
// Moon (plan §16.3)

const MOON_CACHE_DIR = path.join(ROOT, '.cache/moon')

const LROC_MARE_DIR =
  'https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/SHAPEFILE/LROC_GLOBAL_MARE'
const MOON_DOWNLOADS = {
  mare: { url: `${LROC_MARE_DIR}/LROC_GLOBAL_MARE_180.ZIP`, file: 'LROC_GLOBAL_MARE_180.ZIP' },
  nomenclature: {
    url: 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip',
    file: 'MOON_nomenclature_center_pts.zip',
  },
} as const
/** Licence and description documents, saved next to the data for review (not converted). */
const MOON_DOCS = [
  { url: `${LROC_MARE_DIR}/LROC_GLOBAL_MARE_README.TXT`, file: 'LROC_GLOBAL_MARE_README.TXT' },
  {
    url: 'https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/AAREADME.TXT',
    file: 'LROLRC_2001_AAREADME.TXT',
  },
] as const

/** SHA-256 of LROC_GLOBAL_MARE_180.ZIP (downloaded 2026-11-13), pinning the maria. */
const LROC_MARE_SHA256 = 'a85073f6fe05a0b9b38db6cb1d2f667e51c134517debcd1f3b40fda9a58cde88'

/** Mean lunar radius (IAU), km. */
const MOON_RADIUS_KM = 1737.4

async function fetchMoonFile(url: string, file: string, optional = false): Promise<Buffer | null> {
  const cached = path.join(MOON_CACHE_DIR, file)
  try {
    return await readFile(cached)
  } catch {
    // not cached yet
  }
  console.log(`fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) {
    const message = `GET ${url} failed: ${res.status} ${res.statusText}`
    if (optional) {
      console.warn(`  ${message} (skipped)`)
      return null
    }
    throw new Error(message)
  }
  const data = Buffer.from(await res.arrayBuffer())
  await mkdir(MOON_CACHE_DIR, { recursive: true })
  await writeFile(cached, data)
  return data
}

/** The .shp and .dbf of the one shapefile in a zip, read as GeoJSON features. */
async function readZippedShapefile(zipData: Buffer, what: string): Promise<Feature[]> {
  const zip = await JSZip.loadAsync(zipData)
  const find = (ext: string) => {
    const names = Object.keys(zip.files).filter(
      (n) => n.toLowerCase().endsWith(ext) && !n.startsWith('__MACOSX'),
    )
    if (names.length !== 1) {
      throw new Error(`${what}: expected one ${ext} file, found ${JSON.stringify(names)}`)
    }
    return zip.file(names[0]!)!.async('uint8array')
  }
  const prj = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.prj'))
  if (prj) console.log(`  ${what} projection: ${await zip.file(prj)!.async('string')}`)
  const collection = await readShapefile(await find('.shp'), await find('.dbf'), {
    encoding: 'utf-8',
  })
  return collection.features
}

/** Fail with the available fields if `key` (any of the candidates, case-insensitively) is missing. */
function field(features: readonly Feature[], what: string, candidates: readonly string[]): string {
  const keys = Object.keys(features[0]?.properties ?? {})
  const key = keys.find((k) => candidates.includes(k.toLowerCase()))
  if (!key) {
    throw new Error(
      `${what}: none of ${JSON.stringify(candidates)} in fields ${JSON.stringify(keys)}; ` +
        `first record ${JSON.stringify(features[0]?.properties)}`,
    )
  }
  return key
}

/** Distance in degrees from p to segment ab, with longitude scaled by cos(latitude). */
function segmentDistanceDeg(p: Position, a: Position, b: Position): number {
  const k = Math.cos(((a[1]! + b[1]!) / 2) * (Math.PI / 180))
  const [px, py] = [p[0]! * k, p[1]!]
  const [ax, ay] = [a[0]! * k, a[1]!]
  const [bx, by] = [b[0]! * k, b[1]!]
  const [dx, dy] = [bx - ax, by - ay]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Maria coordinates to 0.01° (≈ 0.3 km), well below the simplification tolerance. */
const pos2 = (p: Position): Position => [
  Math.round(p[0]! * 100) / 100,
  Math.round(p[1]! * 100) / 100,
]

/** Douglas–Peucker on an open polyline, keeping both ends. */
function simplifyLine(line: Position[], toleranceDeg: number): Position[] {
  if (line.length <= 2) return line
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length > 0) {
    const [i, j] = stack.pop()!
    let best = -1
    let at = -1
    for (let k = i + 1; k < j; k++) {
      const d = segmentDistanceDeg(line[k]!, line[i]!, line[j]!)
      if (d > best) {
        best = d
        at = k
      }
    }
    if (best > toleranceDeg) {
      keep[at] = 1
      stack.push([i, at], [at, j])
    }
  }
  return line.filter((_, k) => keep[k])
}

/**
 * Simplify a closed GeoJSON ring (first point repeated last). The ring is split at its farthest
 * point from the start so both halves keep their shape. Returns null if it collapses.
 */
function simplifyRing(ring: Position[], toleranceDeg: number): Position[] | null {
  const open = ring.slice(0, -1)
  if (open.length < 3) return null
  let far = 1
  let best = -1
  open.forEach((p, k) => {
    const d = Math.hypot(p[0]! - open[0]![0]!, p[1]! - open[0]![1]!)
    if (d > best) {
      best = d
      far = k
    }
  })
  const first = simplifyLine(open.slice(0, far + 1), toleranceDeg)
  const second = simplifyLine([...open.slice(far), open[0]!], toleranceDeg)
  const out = [...first, ...second.slice(1, -1)].map(pos2)
  if (out.length < 3) return null
  return [...out, out[0]!]
}

/** Lon/lat → Clipper integers for the maria (1e-5° ≈ 0.3 m on the Moon). */
const MARIA_SCALE = 1e5

/** A GeoJSON ring (closed or not) as a Clipper path. */
const toMariaPath = (ring: Position[]): Path64 => {
  const open =
    ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]
      ? ring.slice(0, -1)
      : ring
  return open.map((p) => ({
    x: Math.round(p[0]! * MARIA_SCALE),
    y: Math.round(p[1]! * MARIA_SCALE),
  }))
}

/** A Clipper path as an open ring of 0.01° positions. */
const fromMariaPath = (path: Path64): Position[] =>
  path.map(({ x, y }) => pos2([x / MARIA_SCALE, y / MARIA_SCALE]))

const closeRing = (ring: Position[]): Position[] => [...ring, ring[0]!]

/** Approximate area of a Clipper lon/lat path on the Moon, km² (unsigned). */
function mariaRingKm2(path: Path64): number {
  const meanLat = path.reduce((s, p) => s + p.y, 0) / path.length / MARIA_SCALE
  const deg2 = Math.abs(areaClipper(path)) / MARIA_SCALE ** 2
  return deg2 * Math.cos(meanLat * (Math.PI / 180)) * ((Math.PI / 180) * MOON_RADIUS_KM) ** 2
}

/**
 * Union of lon/lat paths (non-zero), as polygons of open rings: each exterior counter-clockwise
 * followed by its holes, clockwise.
 */
function mariaUnion(paths: Paths64): Position[][][] {
  const tree = new PolyTree64()
  booleanOpWithPolyTree(ClipType.Union, paths, null, tree, FillRule.NonZero)
  const polygons: Position[][][] = []
  const visit = (node: PolyPath64) => {
    for (let i = 0; i < node.count; i++) {
      const outer = node.child(i)
      const rings = [fromMariaPath(outer.poly!)]
      for (let j = 0; j < outer.count; j++) {
        const hole = outer.child(j)
        rings.push(fromMariaPath(hole.poly!))
        visit(hole) // islands inside the hole
      }
      polygons.push(rings)
    }
  }
  visit(tree)
  return polygons
}

/**
 * Maria simplification tolerance: 0.1° ≈ 3 km on the Moon, 0.35 mm on a 400 mm globe. Keeps
 * moon.json near 430 KB (150 KB gzipped); see plan §16.6.
 */
const MARIA_TOLERANCE_DEG = 0.1
/** Maria rings smaller than this are dropped: 50 km² is an 8 km disc, under 1 mm on any globe. */
const MIN_MARIA_RING_KM2 = 50
/** Smallest crater kept, km: the bottom of the crater slider (plan §16.2). */
const MIN_CRATER_KM = 10
/** IAU types kept as craters: named craters and lettered satellite craters ("Copernicus A"). */
const CRATER_TYPES = ['Crater, craters', 'Satellite Feature']

/**
 * The Moon (plan §16.3): maria as d3-wound polygons, simplified, and craters as flat
 * [lon, lat, diameterKm] triples, largest first. Longitude is selenographic, east positive,
 * −180…180°.
 */
async function buildMoon(): Promise<void> {
  for (const doc of MOON_DOCS) {
    const data = await fetchMoonFile(doc.url, doc.file, true)
    if (data) console.log(`  saved ${path.relative(ROOT, path.join(MOON_CACHE_DIR, doc.file))}`)
  }

  // Maria
  const mareZip = (await fetchMoonFile(MOON_DOWNLOADS.mare.url, MOON_DOWNLOADS.mare.file))!
  const hash = createHash('sha256').update(mareZip).digest('hex')
  if (!LROC_MARE_SHA256) {
    console.warn(`  ${MOON_DOWNLOADS.mare.file} sha256 ${hash}: not pinned yet`)
  } else if (hash !== LROC_MARE_SHA256) {
    throw new Error(`${MOON_DOWNLOADS.mare.file} sha256 ${hash}, expected ${LROC_MARE_SHA256}`)
  }
  const mareFeatures = await readZippedShapefile(mareZip, 'maria')
  console.log(
    `  maria: ${mareFeatures.length} features, fields ` +
      JSON.stringify(Object.keys(mareFeatures[0]?.properties ?? {})),
  )
  // The maria in planar lon/lat, as Clipper paths: exteriors counter-clockwise, holes clockwise.
  const paths: Paths64 = []
  let inputPoints = 0
  for (const f of mareFeatures) {
    const g = f.geometry
    if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') continue
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const rings of polygons) {
      for (const [i, ring] of rings.entries()) {
        inputPoints += ring.length
        const lons = ring.map((p) => p[0]!)
        if (!ring.every((p) => Math.abs(p[0]!) <= 180 && Math.abs(p[1]!) <= 90)) {
          throw new Error(`maria: a ring of ${String(f.properties?.MARE_NAME)} is out of bounds`)
        }
        // Planar union is only valid if no ring crosses the antimeridian. (One small mare near
        // 180°, 35–39° S, is already split there in the source; its halves stay apart.)
        if (Math.max(...lons) - Math.min(...lons) > 180) {
          throw new Error(`maria: ${String(f.properties?.MARE_NAME)} crosses the antimeridian`)
        }
        const path = toMariaPath(ring)
        if ((i === 0) !== areaClipper(path) > 0) path.reverse()
        paths.push(path)
      }
    }
  }
  // Merge them, so shared boundaries between neighbouring maria go (they would be stored twice
  // and stroked as lines in Outline mode). Simplify the merged rings, dropping specks, then merge
  // again to clean up any self-crossings the simplification made.
  const simplified = mariaUnion(paths).flatMap((rings) =>
    rings.flatMap((ring) => {
      const simple = simplifyRing(closeRing(ring), MARIA_TOLERANCE_DEG)
      if (!simple) return []
      const path = toMariaPath(simple)
      return mariaRingKm2(path) >= MIN_MARIA_RING_KM2 ? [path] : []
    }),
  )
  // Clipper winds exteriors counter-clockwise (y up); d3 wants clockwise, and rings closed.
  const maria = mariaUnion(simplified).map((rings) =>
    rings.map((ring) => closeRing([...ring].reverse())),
  )
  const mariaRegion: MultiPolygon = { type: 'MultiPolygon', coordinates: maria }
  const mariaShare = geoArea(mariaRegion) / (4 * Math.PI)
  // The maria cover about 16–17 % of the surface (Nelson et al. 2014).
  if (!(mariaShare > 0.13 && mariaShare < 0.2)) {
    throw new Error(`maria cover ${(mariaShare * 100).toFixed(1)} % of the Moon: implausible`)
  }
  const outputPoints = maria.flat().reduce((s, r) => s + r.length - 1, 0)

  // Craters
  const nomenclature = (await fetchMoonFile(
    MOON_DOWNLOADS.nomenclature.url,
    MOON_DOWNLOADS.nomenclature.file,
  ))!
  const named = await readZippedShapefile(nomenclature, 'nomenclature')
  console.log(
    `  nomenclature: ${named.length} features, fields ` +
      JSON.stringify(Object.keys(named[0]?.properties ?? {})),
  )
  const typeKey = field(named, 'nomenclature type', ['type', 'feature_ty', 'ftype', 'feat_type'])
  const diameterKey = field(named, 'nomenclature diameter', ['diameter', 'diam', 'diam_km'])
  const nameKey = field(named, 'nomenclature name', ['name'])
  const craterRecords = named.flatMap((f) => {
    const props = f.properties ?? {}
    const d = Number(props[diameterKey])
    const type = String(props[typeKey])
    const name = String(props[nameKey])
    if (!CRATER_TYPES.includes(type) || !(d >= MIN_CRATER_KM)) return []
    // Satellite features are lettered craters; skip anything else filed under that type.
    if (type === 'Satellite Feature' && !/ [A-Z]{1,2}$/.test(name)) return []
    if (f.geometry?.type !== 'Point') return []
    const [lon, lat] = f.geometry.coordinates as [number, number]
    const lon180 = lon > 180 ? lon - 360 : lon
    if (!(Math.abs(lon180) <= 180 && Math.abs(lat) <= 90)) {
      throw new Error(`crater ${String(props[nameKey])} at ${lon}, ${lat}: outside bounds`)
    }
    // Diameters to 0.1 km, rounded before counting so the counts match what the app shows.
    return [
      {
        name,
        lon: lon180,
        lat,
        d: Math.round(d * 10) / 10,
        satellite: type === 'Satellite Feature',
      },
    ]
  })
  craterRecords.sort((a, b) => b.d - a.d)
  const satellites = craterRecords.filter((c) => c.satellite).length
  if (!(craterRecords.length > 2000 && craterRecords.length < 10000)) {
    throw new Error(`${craterRecords.length} craters: implausible`)
  }
  // Copernicus: about 93–96 km at 9.6° N, 20.1° W.
  const copernicus = craterRecords.find((c) => c.name === 'Copernicus')
  if (
    !copernicus ||
    Math.abs(copernicus.d - 93) > 5 ||
    Math.abs(copernicus.lat - 9.6) > 0.5 ||
    Math.abs(copernicus.lon + 20.1) > 0.5
  ) {
    throw new Error(`Copernicus not where expected: ${JSON.stringify(copernicus)}`)
  }
  const r2 = (x: number) => Math.round(x * 100) / 100
  const craters = craterRecords.flatMap((c) => [r2(c.lon), r2(c.lat), c.d])

  const dest = path.join(OUT_DIR, 'moon.json')
  const json = JSON.stringify({ maria, craters })
  await writeFile(dest, json)
  console.log(
    `moon  ${path.relative(ROOT, dest)}  (${(json.length / 1024).toFixed(0)} KB; ` +
      `${maria.length} maria polygons, ${inputPoints} → ${outputPoints} points, ` +
      `${(mariaShare * 100).toFixed(1)} % of the surface; ${craterRecords.length} craters ≥ ${MIN_CRATER_KM} km, ` +
      `${satellites} of them satellite craters, ` +
      `${craterRecords.filter((c) => c.d >= 30).length} at 30 km or more)`,
  )
}

async function main(): Promise<void> {
  const skipNaturalEarth = process.argv.includes('--skip-natural-earth')
  await mkdir(OUT_DIR, { recursive: true })
  if (process.argv.includes('--moon-only')) {
    await buildMoon()
    return
  }
  await buildWorldAtlas()
  await buildSky()
  await buildMoon()
  if (skipNaturalEarth) console.log('skipping Natural Earth lakes/rivers')
  else await buildNaturalEarth()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
