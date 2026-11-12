import { FillRule, type Paths64, difference } from 'clipper2-ts'

import { SCALE } from '../planar/clipper'

import { rot, rotatedBounds } from './convex'
import { NfpCache, rectIfp } from './nfp'
import { MATCH_TOL_MM, type PreparedParts, toPlacement } from './parts'
import type { NestLayout } from './types'

/**
 * Placement (plan §13.3 Placement and Fitness, §13.4 step 5): put parts on sheets one at a time,
 * in a given order and orientation, each at the leftmost (then lowest) free position on the first
 * sheet that has room.
 */

/** One part on a sheet: its canonical polygon at `part.angles[angle].alpha`, translated to (x, y). */
export interface Placed {
  /** Index into `PreparedParts.parts`. */
  readonly part: number
  /** Index into that part's `angles`. */
  readonly angle: number
  readonly x: number
  readonly y: number
}

export interface PlacementResult {
  /** Parts per sheet, in placement order. Never contains an empty sheet. */
  readonly sheets: readonly (readonly Placed[])[]
  /** Per sheet: rightmost extent of its (padded) parts, measured from the bin's left edge. */
  readonly usedWidths: readonly number[]
  /** Lower is better; the integer part is the sheet count. */
  readonly fitness: number
}

/**
 * NFPs are grown outward by this much (mm) before use, so free positions lie at least this far
 * outside them. Cached NFPs use B rotated by the relative angle modulo B's symmetry period,
 * which matches B at its actual angle only within MATCH_TOL; the extra 0.002 mm covers integer
 * rounding. So padded parts never overlap.
 */
export const NFP_GROWTH_MM = MATCH_TOL_MM + 0.002

/** Weight of each earlier sheet's used width relative to the last sheet's. */
const EARLIER_SHEET_WEIGHT = 0.1

const toInt = (v: number) => Math.round(v * SCALE)

/**
 * Score a placement (plan §13.3 Fitness): fewest sheets first, then the least used width, mostly
 * on the last sheet, so its offcut is one large strip. The fractional part is normalised to
 * [0, 1), so a layout with fewer sheets always wins.
 */
export function fitness(usedWidths: readonly number[], binWidth: number): number {
  const n = usedWidths.length
  if (n === 0) return 0
  const last = usedWidths[n - 1]!
  const earlier = usedWidths.slice(0, -1).reduce((s, w) => s + w, 0)
  const scale = (1 + EARLIER_SHEET_WEIGHT * (n - 1)) * binWidth
  return n + Math.min((last + EARLIER_SHEET_WEIGHT * earlier) / scale, 1 - 1e-12)
}

/** A placed part's grown NFP for the part being placed, in sheet units, with its x extent. */
interface Obstacle {
  readonly path: Paths64[number]
  readonly minX: number
  readonly maxX: number
}

/**
 * Places parts for one set of prepared parts, keeping the NFP cache across calls (the optimiser
 * calls `place` once per individual). Deterministic.
 */
export class Placer {
  readonly prep: PreparedParts
  private readonly cache: NfpCache

  constructor(prep: PreparedParts) {
    this.prep = prep
    this.cache = new NfpCache(prep.shapes, NFP_GROWTH_MM)
  }

  /** Distinct NFPs computed so far. */
  get cacheSize(): number {
    return this.cache.size
  }

  /**
   * Place every part. `order` is a permutation of part indices; `angles[i]` picks an orientation
   * for part i (an index into `parts[i].angles`).
   */
  place(order: readonly number[], angles: readonly number[]): PlacementResult {
    const { parts, shapes, bin } = this.prep
    const sheets: Placed[][] = []
    const usedWidths: number[] = []
    // Per sheet and shape/angle pair: the leftmost free x found last time (Clipper units), or
    // Infinity once it didn't fit. Sheets only fill up, so the free region only shrinks and this
    // is a lower bound for every later search: each one starts at the packing frontier.
    const frontier: Map<string, number>[] = []

    for (const index of order) {
      const part = parts[index]!
      const angleIndex = angles[index] ?? 0
      const beta = part.angles[angleIndex]!.alpha
      const polygon = shapes[part.shape]!.polygon
      const ifp = rectIfp(bin, polygon, beta)
      // Parts that fit at no angle were excluded in prepareParts.
      if (!ifp) throw new Error(`part ${index} does not fit the sheet at its chosen angle`)
      // Round inward, so positions stay inside the bin. A range narrower than one unit (an
      // exact fit) is widened to one unit: at most 0.001 mm into the margin.
      const x0 = Math.ceil(ifp.minX * SCALE)
      const y0 = Math.ceil(ifp.minY * SCALE)
      const x1 = Math.max(Math.floor(ifp.maxX * SCALE), x0 + 1)
      const y1 = Math.max(Math.floor(ifp.maxY * SCALE), y0 + 1)
      const b = rotatedBounds(polygon, beta)
      const key = `${part.shape}:${Math.round(beta * 1e9)}`

      let placed: Placed | null = null
      let sheet = 0
      for (; sheet < sheets.length; sheet++) {
        const from = frontier[sheet]!.get(key) ?? x0
        if (from > x1) continue
        const pos = this.leftmost(sheets[sheet]!, part.shape, beta, from, y0, x1, y1, b)
        frontier[sheet]!.set(key, pos ? pos.x : Infinity)
        if (pos) {
          placed = { part: index, angle: angleIndex, x: pos.x / SCALE, y: pos.y / SCALE }
          break
        }
      }
      if (!placed) {
        sheets.push([])
        usedWidths.push(0)
        frontier.push(new Map())
        sheet = sheets.length - 1
        placed = { part: index, angle: angleIndex, x: x0 / SCALE, y: y0 / SCALE }
      }
      sheets[sheet]!.push(placed)
      usedWidths[sheet] = Math.max(usedWidths[sheet]!, b.maxX + placed.x - bin.minX)
    }
    return { sheets, usedWidths, fitness: fitness(usedWidths, bin.maxX - bin.minX) }
  }

  /**
   * The leftmost, then lowest, free position (Clipper units) for shape `b` at angle `beta` on a
   * sheet, within the integer IFP rectangle [x0, x1] × [y0, y1]; null if the sheet is full.
   * `x0` may be a known lower bound on the answer rather than the IFP's own left edge.
   *
   * Searches a window [x0, xw] that doubles until it holds a free point, clipping only against
   * obstacles that reach into it. The window spans the full height and nothing left of x0 is
   * free, so the leftmost (then lowest) free point inside it, if any, is the leftmost overall.
   */
  private leftmost(
    onSheet: readonly Placed[],
    b: number,
    beta: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    bounds: { minX: number; maxX: number },
  ): { x: number; y: number } | null {
    const { parts } = this.prep
    const obstacles: Obstacle[] = onSheet.map((p) => {
      const other = parts[p.part]!
      const nfp = this.cache.get(other.shape, other.angles[p.angle]!.alpha, b, beta)
      let minX = Infinity
      let maxX = -Infinity
      const path = nfp.map(([x, y]) => {
        const ix = toInt(x + p.x)
        minX = Math.min(minX, ix)
        maxX = Math.max(maxX, ix)
        return { x: ix, y: toInt(y + p.y) }
      })
      return { path, minX, maxX }
    })
    let width = Math.max(1, toInt(bounds.maxX - bounds.minX))
    for (;;) {
      const xw = Math.min(x0 + width, x1)
      const window: Paths64 = [
        [
          { x: x0, y: y0 },
          { x: xw, y: y0 },
          { x: xw, y: y1 },
          { x: x0, y: y1 },
        ],
      ]
      const clips = obstacles.filter((o) => o.minX <= xw && o.maxX >= x0).map((o) => o.path)
      const free = clips.length ? difference(window, clips, FillRule.NonZero) : window
      const best = leftmostVertex(free, x0, y0, x1, y1)
      if (best || xw >= x1) return best
      width *= 2
    }
  }
}

/**
 * The leftmost, then lowest, vertex of a free region, clamped to [x0, x1] × [y0, y1]. Clipper
 * rounds the intersection points it creates to whole units, so a vertex can land one unit outside
 * the window; clamping moves it back by at most that, which NFP_GROWTH's 2-unit rounding
 * allowance covers.
 */
export function leftmostVertex(
  free: Paths64,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  for (const path of free) {
    for (const v of path) {
      const x = Math.min(Math.max(v.x, x0), x1)
      const y = Math.min(Math.max(v.y, y0), y1)
      if (!best || x < best.x || (x === best.x && y < best.y)) best = { x, y }
    }
  }
  return best
}

/** Place every part once with a fresh placer (convenience for one-off placements and tests). */
export function placeParts(
  prep: PreparedParts,
  order: readonly number[],
  angles: readonly number[],
): PlacementResult {
  return new Placer(prep).place(order, angles)
}

/** Convert a placement into the saved layout (plan §13.4 step 2), placements sorted by face. */
export function toLayout(
  prep: PreparedParts,
  result: PlacementResult,
  inputKey: string,
): NestLayout {
  const placements = result.sheets
    .flatMap((placed, sheet) =>
      placed.map((p) => {
        const part = prep.parts[p.part]!
        return toPlacement(part, sheet, part.angles[p.angle]!, [p.x, p.y])
      }),
    )
    .sort((a, b) => a.face - b.face)
  return { inputKey, sheetCount: result.sheets.length, placements, unplaced: [...prep.unplaced] }
}

/** A placed part's padded polygon in sheet coordinates (for previews and tests). */
export function placedPolygon(prep: PreparedParts, p: Placed) {
  const part = prep.parts[p.part]!
  const alpha = part.angles[p.angle]!.alpha
  return prep.shapes[part.shape]!.polygon.map(([x, y]) => {
    const [rx, ry] = rot([x, y], alpha)
    return [rx + p.x, ry + p.y] as const
  })
}
