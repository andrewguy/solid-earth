import type { JointOptions } from '@/core/joints'
import { nestInputKey } from '@/core/nest/key'
import { optimise } from '@/core/nest/optimise'
import { prepareParts } from '@/core/nest/parts'
import { Placer, toLayout } from '@/core/nest/place'
import type { NestLayout, NestSettings } from '@/core/nest/types'
import { panelShapes } from '@/core/panel-shape'
import { longestEdge } from '@/core/pipeline'
import { buildFrames } from '@/core/polyhedron/faces'
import type { PolyhedronDef } from '@/core/polyhedron/types'
import { type Quat, rotate } from '@/core/quat'
import { type ProjectSettings, jointOptions } from '@/core/settings'

/**
 * Sheet nesting behind the worker boundary (plan §13.4 step 7). Kept free of worker APIs so it
 * can be unit-tested directly; `nester.worker.ts` only exposes it via comlink.
 */

/** Everything a nesting run needs; plain data, so it crosses the worker boundary. */
export interface NestRequest {
  /** Must already be preprocessed. */
  readonly polyhedron: PolyhedronDef
  readonly edgeLengthMm: number
  readonly thicknessMm: number
  /** Effective kerf: 0 when kerf compensation is off. */
  readonly kerfMm: number
  readonly joint: JointOptions
  readonly rotation: Quat
  readonly nest: NestSettings
  /** `nestInputKey` of the settings the request was built from; stamped on the layout. */
  readonly inputKey: string
}

export interface NestProgress {
  /** Generations completed, 1-based. */
  readonly generation: number
  readonly generations: number
  /** Best layout so far. */
  readonly sheetCount: number
  readonly fitness: number
}

export interface NestResponse {
  readonly layout: NestLayout
  readonly fitness: number
  readonly evaluations: number
  readonly elapsedMs: number
}

/**
 * The request for a project's current settings. Panel inputs match what the projector is sent
 * (`useProjectionSync`), and the key is the one `currentLayout` checks, so the result is current
 * for exactly these settings.
 */
export function nestRequest(s: ProjectSettings): NestRequest {
  return {
    polyhedron: s.polyhedron,
    edgeLengthMm: s.edgeLengthMm,
    thicknessMm: s.thicknessMm,
    kerfMm: s.kerfEnabled ? s.kerfMm : 0,
    joint: jointOptions(s),
    rotation: s.rotation,
    nest: s.nest,
    inputKey: nestInputKey(s),
  }
}

/** Build the panels, prepare the parts, and run the optimiser. Throws `PanelError` if the
 * material is too thick for the shape. */
export function runNest(req: NestRequest, onProgress?: (p: NestProgress) => void): NestResponse {
  const start = performance.now()
  const frames = buildFrames(req.polyhedron)
  const panels = panelShapes(frames, {
    mmPerUnit: req.edgeLengthMm / longestEdge(frames),
    kerfMm: req.kerfMm,
    thicknessMm: req.thicknessMm,
    joint: req.joint,
    // Only the restricted rotation modes are relative to north-up (plan §13.1).
    north: req.nest.rotationMode === 'free' ? undefined : rotate(req.rotation, [0, 0, 1]),
  })
  const prep = prepareParts(panels, req.nest)
  const result = optimise(new Placer(prep), {
    generations: req.nest.generations,
    population: req.nest.population,
    seed: req.nest.seed,
    onProgress: onProgress
      ? (p) =>
          onProgress({
            generation: p.generation,
            generations: p.generations,
            sheetCount: p.best.sheets.length,
            fitness: p.best.fitness,
          })
      : undefined,
  })
  return {
    layout: toLayout(prep, result.best, req.inputKey),
    fitness: result.best.fitness,
    evaluations: result.evaluations,
    elapsedMs: performance.now() - start,
  }
}

/** Messages from the nester worker, all on its one channel so they arrive in order. */
export type NesterMessage =
  | { readonly type: 'progress'; readonly progress: NestProgress }
  | { readonly type: 'done'; readonly response: NestResponse }
  | { readonly type: 'error'; readonly message: string }

/**
 * Run one request and report through `post`: any number of `progress` messages, then exactly one
 * `done` or `error`. Errors are sent as messages (e.g. a `PanelError` for too-thick material).
 */
export function serveNest(req: NestRequest, post: (m: NesterMessage) => void): void {
  try {
    const response = runNest(req, (progress) => post({ type: 'progress', progress }))
    post({ type: 'done', response })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
