import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseProject, serializeProject } from '@/core/export/project-file'
import { preset } from '@/core/polyhedron/presets'
import { DEFAULT_SETTINGS } from '@/core/settings'
import { AUTOSAVE_KEY, type KeyValueStore, restoreAutosave, startAutosave } from '@/ui/persistence'
import { selectSettings, useAppStore } from '@/ui/store'

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const store: KeyValueStore & { data: Map<string, string> } = {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
  return store
}

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAppStore.getState().applySettings(DEFAULT_SETTINGS)
  })
  afterEach(() => vi.useRealTimers())

  it('saves settings changes after a debounce, in the project-file format', () => {
    const storage = memoryStore()
    const stop = startAutosave(storage, 500)
    useAppStore.getState().setEdgeLengthMm(150)
    useAppStore.getState().setPreset('cube')
    expect(storage.data.has(AUTOSAVE_KEY)).toBe(false)
    vi.advanceTimersByTime(500)
    const { settings } = parseProject(storage.data.get(AUTOSAVE_KEY)!)
    expect(settings.edgeLengthMm).toBe(150)
    expect(settings.preset).toBe('cube')
    stop()
  })

  it('ignores UI-only changes and waits for a drag to finish', () => {
    const storage = memoryStore()
    const stop = startAutosave(storage, 500)
    useAppStore.getState().selectFace(3)
    useAppStore.getState().setShowFaceNumbers(true)
    vi.advanceTimersByTime(1000)
    expect(storage.data.has(AUTOSAVE_KEY)).toBe(false)

    useAppStore.getState().setDragging(true)
    useAppStore.getState().setRotation([0, 0, Math.SQRT1_2, Math.SQRT1_2])
    vi.advanceTimersByTime(1000)
    expect(storage.data.has(AUTOSAVE_KEY)).toBe(false)
    useAppStore.getState().setDragging(false)
    vi.advanceTimersByTime(500)
    expect(parseProject(storage.data.get(AUTOSAVE_KEY)!).settings.rotation[2]).toBeCloseTo(
      Math.SQRT1_2,
    )
    stop()
  })

  it('survives a storage that throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    }
    expect(restoreAutosave(broken)).toEqual({ restored: false, notes: [] })
    const stop = startAutosave(broken, 10)
    useAppStore.getState().setEdgeLengthMm(42)
    expect(() => vi.advanceTimersByTime(20)).not.toThrow()
    stop()
  })
})

describe('restore', () => {
  beforeEach(() => useAppStore.getState().applySettings(DEFAULT_SETTINGS))

  it('restores a saved custom shape and its settings', () => {
    const saved = serializeProject({
      ...DEFAULT_SETTINGS,
      preset: null,
      polyhedron: { ...preset('octahedron'), name: 'diamond' },
      thicknessMm: 4.5,
    })
    const result = restoreAutosave(memoryStore({ [AUTOSAVE_KEY]: saved }))
    expect(result).toEqual({ restored: true, notes: [] })
    const s = useAppStore.getState()
    expect(s.polyhedron.def.name).toBe('diamond')
    expect(s.polyhedron.id).toMatch(/^custom:/)
    expect(s.custom).toBe(s.polyhedron)
    expect(s.thicknessMm).toBe(4.5)
    expect(selectSettings(s).preset).toBeNull()
  })

  it('starts fresh, with a note, when the autosave is corrupt', () => {
    const result = restoreAutosave(memoryStore({ [AUTOSAVE_KEY]: '{oops' }))
    expect(result.restored).toBe(false)
    expect(result.notes[0]).toMatch(/could not be restored/)
    expect(useAppStore.getState().polyhedron.id).toBe('icosahedron')
  })

  it('does nothing without storage or a save', () => {
    expect(restoreAutosave(null)).toEqual({ restored: false, notes: [] })
    expect(restoreAutosave(memoryStore())).toEqual({ restored: false, notes: [] })
  })
})
