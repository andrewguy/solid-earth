import { rotatedBounds } from './convex'
import type { PreparedParts } from './parts'
import type { PlacementResult, Placer } from './place'

/**
 * Genetic optimiser over placement order and orientation (plan §13.3 Optimiser, §13.4 step 6),
 * in the style of Deepnest: the population starts from a greedy individual and its mutations;
 * each generation keeps the best individual, breeds the rest from rank-weighted parents by
 * single-cut order crossover, and mutates them. Deterministic for a given seed and budget.
 */

export interface Individual {
  /** A permutation of part indices. */
  readonly order: readonly number[]
  /** Per part index: an index into that part's `angles`. */
  readonly angles: readonly number[]
}

export interface OptimiseProgress {
  /** Generations completed, 1-based. */
  readonly generation: number
  readonly generations: number
  readonly best: PlacementResult
}

export interface OptimiseOptions {
  readonly generations: number
  readonly population: number
  readonly seed: number
  /** Per-gene probability of a swap or an angle change. Default 0.1. */
  readonly mutationRate?: number
  /** Called after every generation. */
  readonly onProgress?: (p: OptimiseProgress) => void
  /** Checked between generations; returning true stops early with the best so far. */
  readonly shouldStop?: () => boolean
}

export interface OptimiseResult {
  readonly best: PlacementResult
  readonly individual: Individual
  /** Generations actually completed (fewer than asked if stopped). */
  readonly generations: number
  /** Distinct individuals placed. */
  readonly evaluations: number
}

/** mulberry32: a small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The greedy starting individual: largest shapes first (ties by face), each at the orientation
 * with the smallest bounding box, then the narrowest (the layout grows left to right).
 */
export function greedyIndividual(prep: PreparedParts): Individual {
  const { parts, shapes } = prep
  const order = parts
    .map((_, i) => i)
    .sort(
      (a, b) =>
        shapes[parts[b]!.shape]!.area - shapes[parts[a]!.shape]!.area ||
        parts[a]!.face - parts[b]!.face,
    )
  const angles = parts.map((part) => {
    const polygon = shapes[part.shape]!.polygon
    let best = 0
    let bestArea = Infinity
    let bestWidth = Infinity
    part.angles.forEach((a, i) => {
      const b = rotatedBounds(polygon, a.alpha)
      const w = b.maxX - b.minX
      const area = w * (b.maxY - b.minY)
      if (area < bestArea - 1e-9 || (area < bestArea + 1e-9 && w < bestWidth - 1e-9)) {
        best = i
        bestArea = area
        bestWidth = w
      }
    })
    return best
  })
  return { order, angles }
}

/** Swap neighbours and re-pick angles, each with probability `rate` per gene. */
function mutate(
  ind: Individual,
  prep: PreparedParts,
  rate: number,
  rand: () => number,
): Individual {
  const order = [...ind.order]
  const angles = [...ind.angles]
  for (let i = 0; i < order.length; i++) {
    if (i + 1 < order.length && rand() < rate) {
      ;[order[i], order[i + 1]] = [order[i + 1]!, order[i]!]
    }
    const part = order[i]!
    const count = prep.parts[part]!.angles.length
    if (count > 1 && rand() < rate) angles[part] = Math.floor(rand() * count)
  }
  return { order, angles }
}

/**
 * Single-cut order crossover: the child takes `a`'s order up to the cut, then the remaining parts
 * in `b`'s order. Each part keeps the angle of the parent it came from.
 */
function crossover(a: Individual, b: Individual, cut: number): Individual {
  const head = a.order.slice(0, cut)
  const taken = new Set(head)
  const tail = b.order.filter((p) => !taken.has(p))
  const angles = a.angles.map((ang, part) => (taken.has(part) ? ang : b.angles[part]!))
  return { order: [...head, ...tail], angles }
}

const keyOf = (ind: Individual) => `${ind.order.join(',')}|${ind.angles.join(',')}`

/** Run the optimiser on a placer's parts. */
export function optimise(placer: Placer, options: OptimiseOptions): OptimiseResult {
  const { prep } = placer
  const { generations, population, seed, onProgress, shouldStop } = options
  const rate = options.mutationRate ?? 0.1
  const rand = mulberry32(seed)
  const n = prep.parts.length
  const results = new Map<string, PlacementResult>()
  const evaluate = (ind: Individual) => {
    const key = keyOf(ind)
    let r = results.get(key)
    if (!r) {
      r = placer.place(ind.order, ind.angles)
      results.set(key, r)
    }
    return r
  }

  const greedy = greedyIndividual(prep)
  let pop: Individual[] = [greedy]
  while (pop.length < population) pop.push(mutate(greedy, prep, rate, rand))

  let best = { individual: greedy, result: evaluate(greedy) }
  let done = 0
  for (let g = 0; g < generations; g++) {
    if (g > 0 && shouldStop?.()) break
    if (g > 0) {
      // Breed the next generation from this one, ranked best first; the best survives as is.
      const ranked = [...pop].sort((x, y) => evaluate(x).fitness - evaluate(y).fitness)
      // Rank-weighted selection: index ~ size · (1 − √u) favours the front of the ranking.
      const pick = () => ranked[Math.floor(ranked.length * (1 - Math.sqrt(rand())))]!
      const next: Individual[] = [ranked[0]!]
      while (next.length < population) {
        const a = pick()
        const b = pick()
        const cut = Math.floor(rand() * (n + 1))
        next.push(mutate(crossover(a, b, cut), prep, rate, rand))
        if (next.length < population) next.push(mutate(crossover(b, a, cut), prep, rate, rand))
      }
      pop = next
    }
    for (const ind of pop) {
      const r = evaluate(ind)
      if (r.fitness < best.result.fitness) best = { individual: ind, result: r }
    }
    done = g + 1
    onProgress?.({ generation: done, generations, best: best.result })
  }
  return {
    best: best.result,
    individual: best.individual,
    generations: done,
    evaluations: results.size,
  }
}
