import * as Comlink from 'comlink'

import type { Resolution } from '@/core/settings'

import { loadBundledData } from './bundled-data'
import {
  type LineSegments3D,
  type ProjectRequest,
  type ProjectResult,
  Projector,
  transferables,
} from './projector'

const projector = new Projector(loadBundledData)

/** The API the UI sees. Results' typed arrays are transferred, not copied. */
export const api = {
  async project(req: ProjectRequest): Promise<ProjectResult> {
    const result = await projector.project(req)
    return Comlink.transfer(result, transferables(result))
  },
  async lineSegments(resolution: Resolution, graticuleDeg: number): Promise<LineSegments3D> {
    const result = await projector.lineSegments(resolution, graticuleDeg)
    return Comlink.transfer(
      result,
      Object.values(result.lines).map((a) => a.buffer as ArrayBuffer),
    )
  },
}

export type ProjectorApi = typeof api

Comlink.expose(api)
