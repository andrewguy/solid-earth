import { DEFAULT_SVG_OPTIONS, faceToSvg, sheetSvgs } from '@/core/export/svg'
import { prepareLines, preparePolygons } from '@/core/geo/lines'
import {
  type SkyData,
  eclipticAndEquator,
  mirrorLines,
  mirrorSky,
  prepareGreatCircleLines,
  prepareStars,
  starMarkers,
} from '@/core/geo/sky'
import {
  type CountriesTopology,
  type LakesTopology,
  type LandTopology,
  type RiversTopology,
  borderLines,
  coastlineLines,
  graticuleLines,
  lakePolygons,
  lakeShoreLines,
  landPolygons,
  riverLines,
} from '@/core/geo/topojson'
import {
  type FillLayerId,
  type LayerId,
  type LayerStyle,
  type LineSourceId,
  fillsNeeded,
  subjectStyles,
} from '@/core/layers'
import {
  type FaceArtwork,
  type PreparedLine,
  type PreparedMap,
  buildAllFaces,
  longestEdge,
  prepareMap,
  rotateMap,
} from '@/core/pipeline'
import { type PolyhedronFrames, buildFrames } from '@/core/polyhedron/faces'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import { BUTT, type JointOptions } from '@/core/joints'
import { type Quat, rotate } from '@/core/quat'
import type { NestLayout, NestSettings } from '@/core/nest/types'
import type { Resolution } from '@/core/settings'
import type { StarOptions } from '@/core/stars'
import type { Vec2, Vec3 } from '@/core/vec3'

export interface MapSources {
  readonly land: LandTopology
  readonly countries: CountriesTopology
  readonly lakes: LakesTopology
  readonly rivers: RiversTopology
}

/** Loads the raw TopoJSON for a resolution. */
export type DataLoader = (resolution: Resolution) => Promise<MapSources>

/** Loads the bundled sky data (plan §15.3). */
export type SkyLoader = () => Promise<SkyData>

/** Which prepared dataset: Earth at a resolution, or the sky either way round (plan §15). */
export type MapKey = Resolution | 'sky' | 'sky-mirrored'

/** The sky as requested (plan §15.2). Its presence makes the subject the sky. */
export interface SkyRequest {
  /** Mirror to the view from Earth. */
  readonly flip: boolean
  /** RA/Dec grid spacing in degrees. */
  readonly gridIntervalDeg: number
  readonly magLimit: number
  readonly minDiameterMm: number
  readonly maxDiameterMm: number
  /** Used only while the Star holes layer is on. */
  readonly holeMagLimit: number
  readonly holeMinDiameterMm: number
}

/** Live preview star markers: angular radii at magnitude 0 and at the limit. */
export interface LiveStars {
  readonly magLimit: number
  readonly maxRadiusRad: number
  readonly minRadiusRad: number
}

/** The dataset a request needs. */
export const mapKey = (resolution: Resolution, sky?: SkyRequest | null): MapKey =>
  sky ? (sky.flip ? 'sky-mirrored' : 'sky') : resolution

export interface ProjectRequest {
  /** `id` identifies the shape for caching; `def` must already be preprocessed. */
  readonly polyhedron: { readonly id: string; readonly def: PolyhedronDef }
  readonly resolution: Resolution
  readonly edgeLengthMm: number
  readonly rotation: Quat
  readonly layerStyles: Readonly<Record<LayerId, LayerStyle>>
  readonly graticuleIntervalDeg: number
  /** Kerf in mm applied to the cut path; 0 = off. */
  readonly kerfMm?: number
  /** Material thickness in mm; panel edges are inset for square-cut butt joints. 0 = off. */
  readonly thicknessMm?: number
  /** Joint style; default square-cut butt joints. */
  readonly joint?: JointOptions
  /** Show the night sky instead of the Earth (plan §15); `resolution` is then ignored. */
  readonly sky?: SkyRequest | null
  /**
   * false for interactive previews (dragging): skip SVG serialisation and rounding, and only
   * return packed artwork for the 3D textures. Default true.
   */
  readonly wantSvg?: boolean
  /**
   * A sheet layout to render as well (plan §13.4 step 9). Send it only while it is current for
   * these settings (`currentLayout`); its faces must belong to this shape.
   */
  readonly sheets?: SheetRequest
}

export interface SheetRequest {
  readonly layout: NestLayout
  readonly nest: NestSettings
  /** Draw the sheet outline on LightBurn's T1 tool layer. */
  readonly outline: boolean
}

/** Polylines or rings as flat typed arrays (transferable without copying). */
export interface PackedLayer {
  /** x0, y0, x1, y1, … in mm, face frame (y up). */
  readonly coords: Float32Array
  /** Point index where each polyline/ring starts, plus a final entry = total points. */
  readonly starts: Uint32Array
}

export interface PackedFace {
  /** The panel's export rotation (radians); textures undo it to map onto the 3D face. */
  readonly rotation: number
  readonly lines: Partial<Record<LineSourceId, PackedLayer>>
  /** Closed rings (implicitly closed). */
  readonly fills: Partial<Record<FillLayerId, PackedLayer>>
  /** Star holes inside the panel (closed rings), when the Star holes layer is on. */
  readonly holes?: PackedLayer
}

export interface ProjectResult {
  /** Echo of `polyhedron.id`, so callers can discard results for a shape no longer shown. */
  readonly shapeId: string
  readonly shape: string
  readonly mmPerUnit: number
  readonly faces: PackedFace[]
  readonly svgs: string[] | null
  /** One SVG per sheet when `sheets` was requested with SVG output, else null. */
  readonly sheetSvgs: string[] | null
  /** Sky only: stars shown on the whole globe, and how many of them are cut as holes. */
  readonly starCounts: { readonly shown: number; readonly holes: number } | null
  /** Time spent loading/preparing data and projecting; 0 when served from cache. */
  readonly prepareMs: number
  readonly projectMs: number
}

/**
 * Unit-vector line segments for the live GPU preview: xyz pairs (each segment = 2 vertices),
 * unrotated. Sent once per resolution; the 3D view rotates and projects them in a shader.
 */
export interface LineSegments3D {
  readonly lines: Partial<Record<LineSourceId, Float32Array>>
}

/**
 * The projection pipeline behind the worker boundary (plan §7.1). Kept free of worker APIs
 * so it can be unit-tested directly; `projector.worker.ts` only exposes it via comlink.
 *
 * Caches prepared map data per resolution, graticules per interval, and the last artwork set,
 * so layer-style changes that need no new fills only re-serialise SVG.
 */
export class Projector {
  private readonly prepared = new Map<MapKey, Promise<PreparedMap>>()
  private readonly graticules = new Map<number, PreparedLine[]>()
  private frames: { id: string; frames: PolyhedronFrames } | null = null
  private lastArt: { key: string; arts: FaceArtwork[] } | null = null
  private readonly load: DataLoader
  private readonly loadSky: SkyLoader

  constructor(
    load: DataLoader,
    loadSky: SkyLoader = () => Promise.reject(new Error('no sky data')),
  ) {
    this.load = load
    this.loadSky = loadSky
  }

  private preparedMap(key: MapKey): Promise<PreparedMap> {
    let p = this.prepared.get(key)
    if (!p) {
      p =
        key === 'sky' || key === 'sky-mirrored'
          ? this.prepareSky(key === 'sky-mirrored')
          : this.prepareEarth(key)
      // Don't cache failures: allow a retry.
      p.catch(() => this.prepared.delete(key))
      this.prepared.set(key, p)
    }
    return p
  }

  /** The sky (plan §15.1), mirrored to the view from Earth if asked. */
  private async prepareSky(mirrored: boolean): Promise<PreparedMap> {
    const raw = await this.loadSky()
    const sky = mirrored ? mirrorSky(raw) : raw
    const ecliptic = eclipticAndEquator()
    return prepareMap(
      {
        constellations: prepareGreatCircleLines(sky.constellations),
        ecliptic: prepareGreatCircleLines(mirrored ? mirrorLines(ecliptic) : ecliptic),
        milkyWayEdge: prepareLines(sky.milkyWayEdges, 0.5, { keepSeams: true }),
      },
      { milkyWay: preparePolygons(sky.milkyWay) },
      prepareStars(sky.stars),
    )
  }

  private async prepareEarth(resolution: Resolution): Promise<PreparedMap> {
    const { land, countries, lakes, rivers } = await this.load(resolution)
    return prepareMap(
      {
        coastlines: prepareLines(coastlineLines(land)),
        borders: prepareLines(borderLines(countries)),
        rivers: prepareLines(riverLines(rivers)),
        lakeShores: prepareLines(lakeShoreLines(lakes)),
      },
      {
        land: preparePolygons(landPolygons(land)),
        lakes: preparePolygons(lakePolygons(lakes)),
      },
    )
  }

  private graticule(stepDeg: number): PreparedLine[] {
    let g = this.graticules.get(stepDeg)
    if (!g) {
      const lines = prepareLines(graticuleLines(stepDeg), 0.5, { keepSeams: true })
      g = prepareMap({ graticule: lines }).lines.graticule as PreparedLine[]
      this.graticules.set(stepDeg, g)
    }
    return g
  }

  /** Prepared data plus the grid: the graticule for the Earth, the RA/Dec grid for the sky. */
  private async mapFor(key: MapKey, gridDeg: number): Promise<PreparedMap> {
    const base = await this.preparedMap(key)
    const id = key === 'sky' || key === 'sky-mirrored' ? 'skyGrid' : 'graticule'
    return { ...base, lines: { ...base.lines, [id]: this.graticule(gridDeg) } }
  }

  private framesFor({ id, def }: ProjectRequest['polyhedron']): PolyhedronFrames {
    if (this.frames?.id !== id) this.frames = { id, frames: buildFrames(def) }
    return this.frames.frames
  }

  async lineSegments(key: MapKey, gridDeg: number, stars?: LiveStars): Promise<LineSegments3D> {
    const map = await this.mapFor(key, gridDeg)
    const lines: Partial<Record<LineSourceId, Float32Array>> = {}
    const sources = Object.entries(map.lines) as [
      LineSourceId,
      readonly { readonly points: readonly Vec3[] }[],
    ][]
    if (stars && map.stars) {
      // Same sizing as the export: linear in magnitude from magnitude 0 to the limit.
      const { magLimit, maxRadiusRad: big, minRadiusRad: small } = stars
      const radius = (mag: number) =>
        big + Math.min(1, Math.max(0, magLimit > 0 ? mag / magLimit : 0)) * (small - big)
      const markers = starMarkers(map.stars, magLimit, radius)
      sources.push(['starRings', markers.map((points) => ({ points }))])
    }
    for (const [id, ls] of sources) {
      const segments = ls.reduce((n, l) => n + Math.max(0, l.points.length - 1), 0)
      const out = new Float32Array(segments * 6)
      let k = 0
      for (const { points } of ls) {
        for (let i = 0; i + 1 < points.length; i++) {
          out.set(points[i]!, k)
          out.set(points[i + 1]!, k + 3)
          k += 6
        }
      }
      lines[id] = out
    }
    return { lines }
  }

  async project(req: ProjectRequest): Promise<ProjectResult> {
    const frames = this.framesFor(req.polyhedron)
    const wantSvg = req.wantSvg ?? true
    const precisionMm = wantSvg ? 0.01 : null
    const mmPerUnit = req.edgeLengthMm / longestEdge(frames)
    const sky = req.sky ?? null
    // Only the subject's own layers are computed and exported.
    const styles = subjectStyles(req.layerStyles, sky ? 'sky' : 'earth')
    const fills = fillsNeeded(styles)
    const stars: StarOptions | undefined = sky
      ? {
          magLimit: sky.magLimit,
          minDiameterMm: sky.minDiameterMm,
          maxDiameterMm: sky.maxDiameterMm,
          holes: styles.starHoles.enabled
            ? { magLimit: sky.holeMagLimit, minDiameterMm: sky.holeMinDiameterMm }
            : null,
        }
      : undefined
    const key0 = mapKey(req.resolution, sky)
    const gridDeg = sky ? sky.gridIntervalDeg : req.graticuleIntervalDeg
    const kerfMm = req.kerfMm ?? 0
    const thicknessMm = req.thicknessMm ?? 0
    const joint = req.joint ?? BUTT
    const key = JSON.stringify([
      req.polyhedron.id,
      key0,
      req.edgeLengthMm,
      req.rotation,
      precisionMm,
      fills,
      gridDeg,
      kerfMm,
      thicknessMm,
      joint,
      stars ?? null,
    ])
    let prepareMs = 0
    let projectMs = 0
    let starCounts: ProjectResult['starCounts'] = null
    if (stars) {
      const all = (await this.preparedMap(key0)).stars ?? []
      const shown = all.filter((st) => st.mag <= stars.magLimit)
      const holes = stars.holes ? shown.filter((st) => st.mag <= stars.holes!.magLimit).length : 0
      starCounts = { shown: shown.length, holes }
    }
    let arts = this.lastArt?.key === key ? this.lastArt.arts : null
    if (!arts) {
      const t0 = performance.now()
      const map = await this.mapFor(key0, gridDeg)
      const t1 = performance.now()
      arts = buildAllFaces(frames, rotateMap(map, req.rotation), {
        mmPerUnit,
        precisionMm,
        fills,
        kerfMm,
        thicknessMm,
        joint,
        ...(stars && { stars }),
        north: rotate(req.rotation, [0, 0, 1]),
      })
      projectMs = performance.now() - t1
      prepareMs = t1 - t0
      this.lastArt = { key, arts }
    }
    const options = { ...DEFAULT_SVG_OPTIONS, styles }
    let sheets: string[] | null = null
    if (wantSvg && req.sheets) {
      const { layout, nest, outline } = req.sheets
      const bad = layout.placements.find((p) => !arts[p.face])
      if (bad)
        throw new Error(`sheet layout has face ${bad.face}, but the shape has ${arts.length}`)
      // Artwork is cached, so a layout change only re-serialises SVG.
      sheets = sheetSvgs(arts, layout, nest, {
        strokeMm: DEFAULT_SVG_OPTIONS.strokeMm,
        styles,
        outline,
      })
    }
    return {
      shapeId: req.polyhedron.id,
      shape: req.polyhedron.def.name,
      mmPerUnit,
      faces: arts.map(packFace),
      svgs: wantSvg ? arts.map((art) => faceToSvg(art, options)) : null,
      sheetSvgs: sheets,
      starCounts,
      prepareMs,
      projectMs,
    }
  }
}

function pack(polylines: readonly (readonly Vec2[])[]): PackedLayer {
  const total = polylines.reduce((n, pl) => n + pl.length, 0)
  const coords = new Float32Array(total * 2)
  const starts = new Uint32Array(polylines.length + 1)
  let k = 0
  polylines.forEach((pl, i) => {
    starts[i] = k
    for (const [x, y] of pl) {
      coords[2 * k] = x
      coords[2 * k + 1] = y
      k++
    }
  })
  starts[polylines.length] = k
  return { coords, starts }
}

/** Flatten a face's artwork into typed arrays. Always fresh: the buffers get transferred. */
export function packFace(art: FaceArtwork): PackedFace {
  const lines: Partial<Record<LineSourceId, PackedLayer>> = {}
  for (const [id, pls] of Object.entries(art.lines) as [LineSourceId, Vec2[][]][]) {
    lines[id] = pack(pls)
  }
  const fills: Partial<Record<FillLayerId, PackedLayer>> = {}
  for (const [id, rings] of Object.entries(art.fills) as [FillLayerId, Vec2[][]][]) {
    fills[id] = pack(rings)
  }
  return { rotation: art.rotation, lines, fills, ...(art.holes && { holes: pack(art.holes) }) }
}

/** The ArrayBuffers inside a result, for zero-copy transfer out of the worker. */
export function transferables(result: ProjectResult): ArrayBuffer[] {
  return result.faces.flatMap((f) =>
    [...Object.values(f.lines), ...Object.values(f.fills), f.holes].flatMap((l) =>
      l ? [l.coords.buffer as ArrayBuffer, l.starts.buffer as ArrayBuffer] : [],
    ),
  )
}
