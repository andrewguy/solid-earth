import * as Comlink from 'comlink'

import { loadBundledData } from './bundled-data'
import { type ProjectRequest, type ProjectResult, Projector, transferables } from './projector'

const projector = new Projector(loadBundledData)

/** The API the UI sees. Results' typed arrays are transferred, not copied. */
export const api = {
  async project(req: ProjectRequest): Promise<ProjectResult> {
    const result = await projector.project(req)
    return Comlink.transfer(result, transferables(result))
  },
}

export type ProjectorApi = typeof api

Comlink.expose(api)
