import { ProjectFileError, parseProject, serializeProject } from '@/core/export/project-file'
import type { ProjectSettings } from '@/core/settings'
import { selectSettings, useAppStore } from '@/ui/store'

/** localStorage key for the autosaved project (same format as an exported project.json). */
export const AUTOSAVE_KEY = 'solid-earth:autosave'
export const AUTOSAVE_DELAY_MS = 500

/** The subset of Storage we use, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** localStorage if it is usable here (it can throw in private windows or sandboxes). */
export function browserStorage(): KeyValueStore | null {
  try {
    const s = window.localStorage
    const probe = `${AUTOSAVE_KEY}:probe`
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export interface RestoreResult {
  readonly restored: boolean
  /** Non-fatal fixes made while reading, or why the autosave was discarded. */
  readonly notes: string[]
}

/** Load the autosaved project into the store, if there is a usable one. */
export function restoreAutosave(storage: KeyValueStore | null): RestoreResult {
  if (!storage) return { restored: false, notes: [] }
  let text: string | null
  try {
    text = storage.getItem(AUTOSAVE_KEY)
  } catch {
    return { restored: false, notes: [] }
  }
  if (!text) return { restored: false, notes: [] }
  try {
    const { settings, notes } = parseProject(text)
    useAppStore.getState().applySettings(settings)
    return { restored: true, notes }
  } catch (err) {
    // A broken autosave must never stop the app from starting.
    const reason = err instanceof ProjectFileError ? err.message : String(err)
    return { restored: false, notes: [`previous session could not be restored: ${reason}`] }
  }
}

const sameSettings = (a: ProjectSettings, b: ProjectSettings) =>
  (Object.keys(a) as (keyof ProjectSettings)[]).every((k) => a[k] === b[k])

/**
 * Save the project whenever its settings change, debounced (plan §3 Persistence).
 * Returns a function that stops autosaving.
 */
export function startAutosave(
  storage: KeyValueStore | null,
  delayMs = AUTOSAVE_DELAY_MS,
): () => void {
  if (!storage) return () => {}
  let last = selectSettings(useAppStore.getState())
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    timer = null
    try {
      storage.setItem(AUTOSAVE_KEY, serializeProject(last))
    } catch {
      // Quota exceeded or storage revoked: autosave is best-effort.
    }
  }
  const unsubscribe = useAppStore.subscribe((state) => {
    // Rotation changes on every pointer move while dragging; save once the drag ends.
    if (state.dragging) return
    const next = selectSettings(state)
    if (sameSettings(next, last)) return
    last = next
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, delayMs)
  })
  return () => {
    unsubscribe()
    if (timer) {
      clearTimeout(timer)
      save()
    }
  }
}
