import { toast } from 'sonner'

import { nestInputKey } from '@/core/nest/key'
import { NestCancelled, type NesterEndpoint, startNest } from '@/ui/nester-client'
import { selectSettings, useAppStore } from '@/ui/store'
import { nestRequest } from '@/worker/nester'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Nest the current panels (plan §13.4 step 11), reporting progress through the store. The result
 * is saved only if the settings it depends on haven't changed while it ran; otherwise it would be
 * stale on arrival. Resolves when the job ends, however it ends.
 */
export async function runNesting(create?: () => NesterEndpoint): Promise<void> {
  const { setNesting, setNestLayout } = useAppStore.getState()
  const req = nestRequest(selectSettings(useAppStore.getState()))
  const job = startNest(
    req,
    (progress) => {
      const current = useAppStore.getState().nesting
      if (current?.job === job) setNesting({ job, progress })
    },
    create,
  )
  setNesting({ job, progress: null })
  try {
    const { layout } = await job.result
    if (nestInputKey(selectSettings(useAppStore.getState())) !== req.inputKey) {
      toast.warning('Settings changed while nesting', {
        description: 'The result no longer matches the panels or sheet. Nest again.',
      })
      return
    }
    setNestLayout(layout)
    const placed = layout.placements.length
    toast.success(
      `Nested ${plural(placed, 'panel', 'panels')} onto ${plural(layout.sheetCount, 'sheet', 'sheets')}`,
      layout.unplaced.length > 0
        ? { description: `${plural(layout.unplaced.length, 'panel', 'panels')} did not fit.` }
        : undefined,
    )
  } catch (err) {
    if (err instanceof NestCancelled) return
    toast.error('Nesting failed', {
      description: err instanceof Error ? err.message : String(err),
      duration: 10000,
    })
  } finally {
    if (useAppStore.getState().nesting?.job === job) setNesting(null)
  }
}

/** Stop the running nesting job, keeping the previous layout. */
export function cancelNesting(): void {
  useAppStore.getState().nesting?.job.cancel()
}
