import { beforeEach, describe, expect, it } from 'vitest'

import { nestInputKey } from '@/core/nest/key'
import { DEFAULT_NEST_SETTINGS } from '@/core/nest/types'
import { DEFAULT_SETTINGS } from '@/core/settings'
import type { NesterEndpoint } from '@/ui/nester-client'
import { cancelNesting, runNesting } from '@/ui/nesting'
import { selectCurrentLayout, selectSettings, useAppStore } from '@/ui/store'
import { type NestRequest, type NesterMessage, serveNest } from '@/worker/nester'

/**
 * A worker stand-in on a MessageChannel. Requests wait until `respond()` runs them with
 * `serve` (default: the real nester), so tests can act while a job is "running".
 */
function fakeWorker(
  serve: (req: NestRequest, post: (m: NesterMessage) => void) => void = serveNest,
) {
  const { port1, port2 } = new MessageChannel()
  let pending: (() => void) | null = null
  port1.addEventListener('message', (ev: MessageEvent<NestRequest>) => {
    pending = () => serve(ev.data, (m) => port1.postMessage(m))
  })
  port1.start()
  const state = { terminated: false }
  const endpoint: NesterEndpoint = {
    postMessage: (req) => port2.postMessage(req),
    addEventListener: (type: 'message' | 'error', listener: (ev: never) => void) => {
      if (type === 'message') {
        port2.addEventListener('message', listener as (ev: Event) => void)
        port2.start()
      }
    },
    terminate: () => {
      state.terminated = true
      port1.close()
      port2.close()
    },
  }
  /** Wait for the request to arrive, then serve it. */
  const respond = async () => {
    while (!pending) await new Promise((r) => setTimeout(r, 1))
    pending()
  }
  return { create: () => endpoint, respond, state }
}

beforeEach(() => {
  const { applySettings, setNestLayout, setNesting } = useAppStore.getState()
  applySettings({
    ...DEFAULT_SETTINGS,
    edgeLengthMm: 60,
    nest: {
      ...DEFAULT_NEST_SETTINGS,
      sheetWidthMm: 300,
      sheetHeightMm: 200,
      generations: 3,
      population: 3,
    },
  })
  setNestLayout(null)
  setNesting(null)
})

describe('runNesting', () => {
  it('saves the layout, reporting progress through the store while it runs', async () => {
    const w = fakeWorker()
    const seen: number[] = []
    const unsubscribe = useAppStore.subscribe((s) => {
      const g = s.nesting?.progress?.generation
      if (g !== undefined && seen.at(-1) !== g) seen.push(g)
    })
    const done = runNesting(w.create)
    expect(useAppStore.getState().nesting).not.toBeNull()
    await w.respond()
    await done
    unsubscribe()
    const s = useAppStore.getState()
    expect(seen).toEqual([1, 2, 3])
    expect(s.nesting).toBeNull()
    expect(s.nestLayout).not.toBeNull()
    expect(selectCurrentLayout(s)).toBe(s.nestLayout)
    expect(s.nestLayout!.inputKey).toBe(nestInputKey(selectSettings(s)))
    expect(w.state.terminated).toBe(true)
  })

  it('discards a result whose settings changed while it ran', async () => {
    const w = fakeWorker()
    const done = runNesting(w.create)
    useAppStore.getState().setEdgeLengthMm(80)
    await w.respond()
    await done
    expect(useAppStore.getState().nestLayout).toBeNull()
    expect(useAppStore.getState().nesting).toBeNull()
  })

  it('keeps the previous layout when cancelled', async () => {
    const first = fakeWorker()
    const p1 = runNesting(first.create)
    await first.respond()
    await p1
    const previous = useAppStore.getState().nestLayout

    const second = fakeWorker()
    const p2 = runNesting(second.create)
    cancelNesting()
    await p2
    expect(second.state.terminated).toBe(true)
    expect(useAppStore.getState().nestLayout).toBe(previous)
    expect(useAppStore.getState().nesting).toBeNull()
  })

  it('keeps the previous layout when the worker fails', async () => {
    const w = fakeWorker((_, post) => post({ type: 'error', message: 'Material is too thick' }))
    const done = runNesting(w.create)
    await w.respond()
    await done
    expect(useAppStore.getState().nestLayout).toBeNull()
    expect(useAppStore.getState().nesting).toBeNull()
  })
})

describe('selectCurrentLayout', () => {
  it('returns the stored layout while current, null once stale', async () => {
    expect(selectCurrentLayout(useAppStore.getState())).toBeNull()
    const w = fakeWorker()
    const done = runNesting(w.create)
    await w.respond()
    await done
    const layout = useAppStore.getState().nestLayout
    expect(selectCurrentLayout(useAppStore.getState())).toBe(layout)
    useAppStore.getState().setNest({ gapMm: 3 })
    expect(selectCurrentLayout(useAppStore.getState())).toBeNull()
    useAppStore.getState().setNest({ gapMm: DEFAULT_NEST_SETTINGS.gapMm })
    expect(selectCurrentLayout(useAppStore.getState())).toBe(layout)
    useAppStore.getState().setNest({ generations: 99, sheetOutline: true }) // not layout inputs
    expect(selectCurrentLayout(useAppStore.getState())).toBe(layout)
  })
})

describe('setProjection', () => {
  it('keeps sheet previews alongside faces, and replaces both', () => {
    const { setProjection } = useAppStore.getState()
    setProjection({
      shape: 'x',
      svgs: ['<svg/>'],
      sheetSvgs: ['<svg a/>', '<svg b/>'],
      prepareMs: 0,
      projectMs: 0,
    })
    const p = useAppStore.getState().projection!
    expect(p.faces).toHaveLength(1)
    expect(p.sheets.map((s) => s.svg)).toEqual(['<svg a/>', '<svg b/>'])
    for (const s of p.sheets) expect(s.url).toMatch(/^blob:/)
    setProjection({ shape: 'x', svgs: ['<svg/>'], prepareMs: 0, projectMs: 0 })
    expect(useAppStore.getState().projection!.sheets).toEqual([])
  })
})
