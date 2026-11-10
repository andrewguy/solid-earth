import { DEFAULT_SVG_OPTIONS, faceToSvg } from '@/core/export/svg'
import { prepareLines } from '@/core/geo/lines'
import {
  type CountriesTopology,
  type LandTopology,
  borderLines,
  coastlineLines,
} from '@/core/geo/topojson'
import type { LayerId, LayerStyle, LineLayerId } from '@/core/layers'
import {
  type FaceArtwork,
  type PreparedMap,
  buildAllFaces,
  longestEdge,
  prepareMap,
  rotateMap,
} from '@/core/pipeline'
import { type PolyhedronFrames, buildFrames } from '@/core/polyhedron/faces'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import type { Quat } from '@/core/quat'
import type { Resolution } from '@/core/settings'

export interface MapSources {
  readonly land: LandTopology
  readonly countries: CountriesTopology
}

export type DataLoader = (resolution: Resolution) => Promise<MapSources>

export interface ProjectRequest {
  /** `id` identifies the shape for caching; `def` must already be preprocessed. */
  readonly polyhedron: { readonly id: string; readonly def: PolyhedronDef }
  readonly resolution: Resolution
  readonly edgeLengthMm: number
  readonly rotation: Quat
  readonly layerStyles: Readonly<Record<LayerId, LayerStyle>>
  /**
   * false for interactive previews (dragging): skip SVG serialisation and rounding, and only
   * return packed artwork for the 3D textures. Default true.
   */
  readonly wantSvg?: boolean
}

/** A layer's polylines as flat typed arrays (transferable without copying). */
export interface PackedLayer {
  /** x0, y0, x1, y1, … in mm, face frame (y up). */
  readonly coords: Float32Array
  /** Point index where each polyline starts, plus a final entry = total points. */
  readonly starts: Uint32Array
}

export interface PackedFace {
  readonly layers: Partial<Record<LineLayerId, PackedLayer>>
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
 * The projection pipeline behind the worker boundary (plan §7.1). Kept free of worker APIs
 * so it can be unit-tested directly; `projector.worker.ts` only exposes it via comlink.
 *
 * Caches prepared map data per resolution, and the last artwork set, so layer-style changes
 * only re-serialise SVG.
 */
export class Projector {
  private readonly prepared = new Map<Resolution, Promise<PreparedMap>>()
  private frames: { id: string; frames: PolyhedronFrames } | null = null
  private lastArt: { key: string; arts: FaceArtwork[] } | null = null

  private readonly load: DataLoader

  constructor(load: DataLoader) {
    this.load = load
  }

  private preparedMap(resolution: Resolution): Promise<PreparedMap> {
    let p = this.prepared.get(resolution)
    if (!p) {
      p = this.load(resolution).then(({ land, countries }) =>
        prepareMap({
          coastlines: prepareLines(coastlineLines(land)),
          borders: prepareLines(borderLines(countries)),
        }),
      )
      // Don't cache failures: allow a retry.
      p.catch(() => this.prepared.delete(resolution))
      this.prepared.set(resolution, p)
    }
    return p
  }

  private framesFor({ id, def }: ProjectRequest['polyhedron']): PolyhedronFrames {
    if (this.frames?.id !== id) this.frames = { id, frames: buildFrames(def) }
    return this.frames.frames
  }

  async project(req: ProjectRequest): Promise<ProjectResult> {
    const frames = this.framesFor(req.polyhedron)
    const wantSvg = req.wantSvg ?? true
    const precisionMm = wantSvg ? 0.01 : null
    const mmPerUnit = req.edgeLengthMm / longestEdge(frames)
    const key = JSON.stringify([
      req.polyhedron.id,
      req.resolution,
      req.edgeLengthMm,
      req.rotation,
      precisionMm,
    ])
    let prepareMs = 0
    let projectMs = 0
    let arts = this.lastArt?.key === key ? this.lastArt.arts : null
    if (!arts) {
      const t0 = performance.now()
      const map = await this.preparedMap(req.resolution)
      const t1 = performance.now()
      arts = buildAllFaces(frames, rotateMap(map, req.rotation), { mmPerUnit, precisionMm })
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

/** Flatten a face's polylines into typed arrays. Always fresh: the buffers get transferred. */
export function packFace(art: FaceArtwork): PackedFace {
  const layers: Partial<Record<LineLayerId, PackedLayer>> = {}
  for (const [id, layer] of Object.entries(art.layers) as [
    LineLayerId,
    FaceArtwork['layers'][LineLayerId],
  ][]) {
    if (!layer) continue
    const total = layer.polylines.reduce((n, pl) => n + pl.length, 0)
    const coords = new Float32Array(total * 2)
    const starts = new Uint32Array(layer.polylines.length + 1)
    let k = 0
    layer.polylines.forEach((pl, i) => {
      starts[i] = k
      for (const [x, y] of pl) {
        coords[2 * k] = x
        coords[2 * k + 1] = y
        k++
      }
    })
    starts[layer.polylines.length] = k
    layers[id] = { coords, starts }
  }
  return { layers }
}

/** The ArrayBuffers inside a result, for zero-copy transfer out of the worker. */
export function transferables(result: ProjectResult): ArrayBuffer[] {
  return result.faces.flatMap((f) =>
    Object.values(f.layers).flatMap((l) => (l ? [l.coords.buffer, l.starts.buffer] : [])),
  ) as ArrayBuffer[]
}
