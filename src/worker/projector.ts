import { DEFAULT_SVG_OPTIONS, faceToSvg } from '@/core/export/svg'
import { prepareLines } from '@/core/geo/lines'
import {
  type CountriesTopology,
  type LandTopology,
  borderLines,
  coastlineLines,
} from '@/core/geo/topojson'
import type { LayerId, LayerStyle } from '@/core/layers'
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
}

export interface ProjectResult {
  readonly shape: string
  readonly svgs: string[]
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
    const key = JSON.stringify([req.polyhedron.id, req.resolution, req.edgeLengthMm, req.rotation])
    let prepareMs = 0
    let projectMs = 0
    let arts = this.lastArt?.key === key ? this.lastArt.arts : null
    if (!arts) {
      const t0 = performance.now()
      const map = await this.preparedMap(req.resolution)
      const t1 = performance.now()
      arts = buildAllFaces(frames, rotateMap(map, req.rotation), {
        mmPerUnit: req.edgeLengthMm / longestEdge(frames),
        precisionMm: 0.01,
      })
      projectMs = performance.now() - t1
      prepareMs = t1 - t0
      this.lastArt = { key, arts }
    }
    const options = { ...DEFAULT_SVG_OPTIONS, styles: req.layerStyles }
    return {
      shape: req.polyhedron.def.name,
      svgs: arts.map((art) => faceToSvg(art, options)),
      prepareMs,
      projectMs,
    }
  }
}
