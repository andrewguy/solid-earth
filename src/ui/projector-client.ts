import * as Comlink from 'comlink'

import type { Projector } from '@/worker/projector'

let remote: Comlink.Remote<Projector> | null = null

/** The projection worker, started on first use. */
export function projector(): Comlink.Remote<Projector> {
  remote ??= Comlink.wrap<Projector>(
    new Worker(new URL('../worker/projector.worker.ts', import.meta.url), { type: 'module' }),
  )
  return remote
}
