import type { NestProgress, NestRequest, NestResponse, NesterMessage } from '@/worker/nester'

/** The job was cancelled, or replaced by a newer one, before it finished. */
export class NestCancelled extends Error {
  override name = 'NestCancelled'
  constructor() {
    super('nesting was cancelled')
  }
}

/** The parts of a Worker the client uses (a real Worker, or a test double). */
export interface NesterEndpoint {
  postMessage(req: NestRequest): void
  addEventListener(type: 'message', listener: (ev: MessageEvent<NesterMessage>) => void): void
  /** A script that fails to load, or an uncaught error outside `serveNest`. */
  addEventListener(type: 'error', listener: (ev: ErrorEvent) => void): void
  terminate(): void
}

const defaultEndpoint = (): NesterEndpoint =>
  new Worker(new URL('../worker/nester.worker.ts', import.meta.url), { type: 'module' })

export interface NestJob {
  /** Resolves with the result, or rejects with `NestCancelled` or the worker's error. */
  readonly result: Promise<NestResponse>
  /** Stop the job now; `result` rejects with `NestCancelled`. No effect once settled. */
  cancel(): void
}

let current: NestJob | null = null

/**
 * Run a nesting job in its own worker (plan §13.4 step 7). The optimiser loop is synchronous, so
 * cancelling terminates the worker rather than messaging it; a fresh worker per job also means
 * nothing lingers between jobs. Starting a job cancels any job still running.
 *
 * Progress, result and errors share the worker's one channel, so every progress message is
 * delivered before the result. (Separate ports, as a comlink callback would use, don't keep
 * that order.)
 */
export function startNest(
  req: NestRequest,
  onProgress?: (p: NestProgress) => void,
  create: () => NesterEndpoint = defaultEndpoint,
): NestJob {
  current?.cancel()
  const worker = create()
  let settle: { resolve: (r: NestResponse) => void; reject: (e: Error) => void } | null = null
  const result = new Promise<NestResponse>((resolve, reject) => {
    settle = { resolve, reject }
  })
  const finish = () => {
    const s = settle
    settle = null
    if (s) {
      worker.terminate()
      if (current === job) current = null
    }
    return s
  }
  worker.addEventListener('message', ({ data }) => {
    if (!settle) return
    if (data.type === 'progress') onProgress?.(data.progress)
    else if (data.type === 'done') finish()?.resolve(data.response)
    else finish()?.reject(new Error(data.message))
  })
  worker.addEventListener('error', (ev) => {
    ev.preventDefault?.()
    finish()?.reject(new Error(ev.message || 'the nesting worker failed'))
  })
  const job: NestJob = { result, cancel: () => finish()?.reject(new NestCancelled()) }
  current = job
  worker.postMessage(req)
  return job
}
