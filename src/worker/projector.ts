import { DEFAULT_SVG_OPTIONS, faceToSvg } from '@/core/export/svg'
import { prepareLines, preparePolygons } from '@/core/geo/lines'
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
import { type Quat, rotate } from '@/core/quat'
import type { Resolution } from '@/core/settings'
import type { Vec2 } from '@/core/vec3'

export interface MapSources {
  readonly land: LandTopology
  readonly countries: CountriesTopology
  readonly lakes: LakesTopology
  readonly rivers: RiversTopology
}

/** Loads the raw TopoJSON for a resolution. */
export type DataLoader = (resolution: Resolution) => Promise<MapSources>

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
  /**
   * false for interactive previews (dragging): skip SVG serialisation and rounding, and only
   * return packed artwork for the 3D textures. Default true.
   */
  readonly wantSvg?: boolean
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
}

export interface ProjectResult {
  /** Echo of `polyhedron.id`, so callers can discard results for a shape no longer shown. */
  readonly shapeId: string
  readonly shape: string
  readonly mmPerUnit: number
  readonly faces: PackedFace[]
  readonly svgs: string[] | null
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
  private readonly prepared = new Map<Resolution, Promise<PreparedMap>>()
  private readonly graticules = new Map<number, PreparedLine[]>()
  private frames: { id: string; frames: PolyhedronFrames } | null = null
  private lastArt: { key: string; arts: FaceArtwork[] } | null = null
  private readonly load: DataLoader

  constructor(load: DataLoader) {
    this.load = load
  }

  private preparedMap(resolution: Resolution): Promise<PreparedMap> {
    let p = this.prepared.get(resolution)
    if (!p) {
      p = this.load(resolution).then(({ land, countries, lakes, rivers }) =>
        prepareMap(
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
        ),
      )
      // Don't cache failures: allow a retry.
      p.catch(() => this.prepared.delete(resolution))
      this.prepared.set(resolution, p)
    }
    return p
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

  /** Prepared data for a resolution plus the graticule. */
  private async mapFor(resolution: Resolution, graticuleDeg: number): Promise<PreparedMap> {
    const base = await this.preparedMap(resolution)
    return { ...base, lines: { ...base.lines, graticule: this.graticule(graticuleDeg) } }
  }

  private framesFor({ id, def }: ProjectRequest['polyhedron']): PolyhedronFrames {
    if (this.frames?.id !== id) this.frames = { id, frames: buildFrames(def) }
    return this.frames.frames
  }

  async lineSegments(resolution: Resolution, graticuleDeg: number): Promise<LineSegments3D> {
    const map = await this.mapFor(resolution, graticuleDeg)
    const lines: Partial<Record<LineSourceId, Float32Array>> = {}
    for (const [id, ls] of Object.entries(map.lines) as [LineSourceId, PreparedLine[]][]) {
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
    const fills = fillsNeeded(req.layerStyles)
    const kerfMm = req.kerfMm ?? 0
    const key = JSON.stringify([
      req.polyhedron.id,
      req.resolution,
      req.edgeLengthMm,
      req.rotation,
      precisionMm,
      fills,
      req.graticuleIntervalDeg,
      kerfMm,
    ])
    let prepareMs = 0
    let projectMs = 0
    let arts = this.lastArt?.key === key ? this.lastArt.arts : null
    if (!arts) {
      const t0 = performance.now()
      const map = await this.mapFor(req.resolution, req.graticuleIntervalDeg)
      const t1 = performance.now()
      arts = buildAllFaces(frames, rotateMap(map, req.rotation), {
        mmPerUnit,
        precisionMm,
        fills,
        kerfMm,
        north: rotate(req.rotation, [0, 0, 1]),
      })
      projectMs = performance.now() - t1
      prepareMs = t1 - t0
      this.lastArt = { key, arts }
    }
    const options = { ...DEFAULT_SVG_OPTIONS, styles: req.layerStyles }
    return {
      shapeId: req.polyhedron.id,
      shape: req.polyhedron.def.name,
      mmPerUnit,
      faces: arts.map(packFace),
      svgs: wantSvg ? arts.map((art) => faceToSvg(art, options)) : null,
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
  return { rotation: art.rotation, lines, fills }
}

/** The ArrayBuffers inside a result, for zero-copy transfer out of the worker. */
export function transferables(result: ProjectResult): ArrayBuffer[] {
  return result.faces.flatMap((f) =>
    [...Object.values(f.lines), ...Object.values(f.fills)].flatMap((l) =>
      l ? [l.coords.buffer as ArrayBuffer, l.starts.buffer as ArrayBuffer] : [],
    ),
  )
}
