import * as Comlink from 'comlink'

import type { ProjectorApi } from '@/worker/projector.worker'

let remote: Comlink.Remote<ProjectorApi> | null = null

/** The projection worker, started on first use. */
export function projector(): Comlink.Remote<ProjectorApi> {
  remote ??= Comlink.wrap<ProjectorApi>(
    new Worker(new URL('../worker/projector.worker.ts', import.meta.url), { type: 'module' }),
  )
  return remote
}
