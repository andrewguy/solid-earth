import { type NestRequest, type NesterMessage, serveNest } from './nester'

/**
 * Each worker runs one request (plan §13.4 step 7). Progress, result and errors go back as plain
 * messages on the worker's own channel, which keeps them in order; cancelling terminates the
 * worker (see `nester-client.ts`).
 */
self.onmessage = (ev: MessageEvent<NestRequest>) => {
  serveNest(ev.data, (m: NesterMessage) => self.postMessage(m))
}
