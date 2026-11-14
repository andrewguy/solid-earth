import { describe, expect, it } from 'vitest'

import { parseProject, serializeProject } from '@/core/export/project-file'
import { currentLayout, nestInputKey } from '@/core/nest/key'
import { DEFAULT_NEST_SETTINGS, type NestSettings } from '@/core/nest/types'
import { PanelError } from '@/core/panel'
import { preset } from '@/core/polyhedron/presets'
import { fromAxisAngle } from '@/core/quat'
import { DEFAULT_SETTINGS, type ProjectSettings } from '@/core/settings'
import { NestCancelled, type NesterEndpoint, startNest } from '@/ui/nester-client'
import {
  type NestRequest,
  type NesterMessage,
  nestRequest,
  runNest,
  serveNest,
} from '@/worker/nester'

const base: ProjectSettings = {
  ...DEFAULT_SETTINGS,
  edgeLengthMm: 60,
  rotation: fromAxisAngle([1, 2, 3], 0.7),
  nest: {
    ...DEFAULT_NEST_SETTINGS,
    sheetWidthMm: 300,
    sheetHeightMm: 200,
    generations: 3,
    population: 4,
  },
}
const withNest = (patch: Partial<NestSettings>): ProjectSettings => ({
  ...base,
  nest: { ...base.nest, ...patch },
})

describe('nestRequest', () => {
  it('sends the same panel inputs as the projector, and the current input key', () => {
    const s: ProjectSettings = { ...base, kerfEnabled: false, kerfMm: 0.3, joint: 'finger' }
    const req = nestRequest(s)
    expect(req.kerfMm).toBe(0)
    expect(nestRequest({ ...s, kerfEnabled: true }).kerfMm).toBe(0.3)
    expect(req.joint).toEqual({
      kind: 'finger',
      widthMm: 10,
      tip: 'fill',
      fill: 0.5,
      clearanceMm: 0.1,
    })
    expect(req.inputKey).toBe(nestInputKey(s))
  })
})

describe('runNest', () => {
  it('returns a complete layout that is current for the settings, and survives saving', () => {
    const progress: { generation: number; fitness: number; sheetCount: number }[] = []
    const r = runNest(nestRequest(base), (p) => progress.push(p))
    const { layout } = r
    const faces = [...layout.placements.map((p) => p.face), ...layout.unplaced].sort(
      (a, b) => a - b,
    )
    expect(faces).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(layout.sheetCount).toBe(Math.floor(r.fitness))
    expect(new Set(layout.placements.map((p) => p.sheet)).size).toBe(layout.sheetCount)

    const saved = { ...base, nestLayout: layout }
    expect(currentLayout(saved)).toBe(layout)
    const reloaded = parseProject(serializeProject(saved))
    expect(reloaded.notes).toEqual([])
    expect(currentLayout(reloaded.settings)).toEqual(layout)

    expect(progress.map((p) => p.generation)).toEqual([1, 2, 3])
    expect(progress.at(-1)!.fitness).toBe(r.fitness)
    expect(progress.at(-1)!.sheetCount).toBe(layout.sheetCount)
  })

  it.each<[NestSettings['rotationMode'], number[]]>([
    ['none', [0]],
    ['180', [0, 180]],
    ['90', [0, 90, 180, 270]],
  ])('only uses the allowed north-up rotations in %s mode', (rotationMode, allowed) => {
    const { layout } = runNest(nestRequest(withNest({ rotationMode })))
    expect(layout.placements.length).toBeGreaterThan(0)
    for (const p of layout.placements) {
      expect(allowed.some((a) => Math.abs(p.angleDeg - a) < 1e-9)).toBe(true)
    }
  })

  it('reports panels too big for the sheet as unplaced', () => {
    const { layout } = runNest(nestRequest(withNest({ sheetWidthMm: 40, sheetHeightMm: 40 })))
    expect(layout.sheetCount).toBe(0)
    expect(layout.placements).toEqual([])
    expect(layout.unplaced).toHaveLength(20)
  })

  it('throws PanelError when the material is too thick for the shape', () => {
    const req = nestRequest({
      ...base,
      polyhedron: preset('tetrahedron'),
      preset: 'tetrahedron',
      edgeLengthMm: 10,
      thicknessMm: 20,
    })
    expect(() => runNest(req)).toThrow(PanelError)
  })
})

describe('serveNest', () => {
  it('posts progress, then done', () => {
    const msgs: NesterMessage[] = []
    serveNest(nestRequest(base), (m) => msgs.push(m))
    expect(msgs.map((m) => m.type)).toEqual(['progress', 'progress', 'progress', 'done'])
  })

  it('posts errors as messages', () => {
    const msgs: NesterMessage[] = []
    const req = nestRequest({
      ...base,
      polyhedron: preset('tetrahedron'),
      preset: 'tetrahedron',
      edgeLengthMm: 10,
      thicknessMm: 20,
    })
    serveNest(req, (m) => msgs.push(m))
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ type: 'error', message: expect.stringMatching(/too thick/) })
  })
})

describe('startNest', () => {
  /**
   * A worker stand-in on a MessageChannel. `serve` plays the worker: it gets each request and a
   * `post` for replies.
   */
  function fakeWorker(serve: (req: NestRequest, post: (m: NesterMessage) => void) => void) {
    const { port1, port2 } = new MessageChannel()
    port1.addEventListener('message', (ev: MessageEvent<NestRequest>) =>
      serve(ev.data, (m) => port1.postMessage(m)),
    )
    port1.start()
    const handle = { terminated: false }
    const errorListeners: ((ev: ErrorEvent) => void)[] = []
    const fail = (message: string) =>
      errorListeners.forEach((l) => l({ message, preventDefault: () => {} } as ErrorEvent))
    const endpoint: NesterEndpoint = {
      postMessage: (req) => port2.postMessage(req),
      addEventListener: (type: 'message' | 'error', listener: (ev: never) => void) => {
        if (type === 'error') errorListeners.push(listener as (ev: ErrorEvent) => void)
        else {
          port2.addEventListener('message', listener as (ev: Event) => void)
          port2.start()
        }
      },
      terminate: () => {
        handle.terminated = true
        port1.close()
        port2.close()
      },
    }
    return { endpoint, handle, fail }
  }
  const never = () => {}

  it('runs the job, forwards progress before the result, and shuts the worker down', async () => {
    const { endpoint, handle } = fakeWorker(serveNest)
    const seen: number[] = []
    const job = startNest(
      nestRequest(base),
      (p) => seen.push(p.generation),
      () => endpoint,
    )
    const r = await job.result
    expect(r.layout.inputKey).toBe(nestInputKey(base))
    expect(seen).toEqual([1, 2, 3])
    expect(handle.terminated).toBe(true)
  })

  it('cancels: rejects with NestCancelled and terminates the worker', async () => {
    const { endpoint, handle } = fakeWorker(never)
    const job = startNest(nestRequest(base), undefined, () => endpoint)
    job.cancel()
    await expect(job.result).rejects.toBeInstanceOf(NestCancelled)
    expect(handle.terminated).toBe(true)
    job.cancel() // harmless once settled
  })

  it('cancels the running job when a new one starts', async () => {
    const first = fakeWorker(never)
    const second = fakeWorker(serveNest)
    const a = startNest(nestRequest(base), undefined, () => first.endpoint)
    const b = startNest(nestRequest(base), undefined, () => second.endpoint)
    await expect(a.result).rejects.toBeInstanceOf(NestCancelled)
    expect(first.handle.terminated).toBe(true)
    await expect(b.result).resolves.toBeTruthy()
  })

  it('rejects when the worker itself fails', async () => {
    const w = fakeWorker(never)
    const job = startNest(nestRequest(base), undefined, () => w.endpoint)
    w.fail('script failed to load')
    await expect(job.result).rejects.toThrow('script failed to load')
    expect(w.handle.terminated).toBe(true)
  })

  it('passes worker errors through', async () => {
    const { endpoint, handle } = fakeWorker((_, post) =>
      post({ type: 'error', message: 'too thick' }),
    )
    const job = startNest(nestRequest(base), undefined, () => endpoint)
    await expect(job.result).rejects.toThrow('too thick')
    expect(handle.terminated).toBe(true)
  })
})
