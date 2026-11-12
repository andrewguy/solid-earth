import { type ReactNode, useState } from 'react'

import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'

/** A titled group of controls in the left panel. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

/**
 * A labelled number input with a unit. It keeps a draft so the field can be cleared or hold
 * partial input while typing; accepted values are committed as the user types. Changes from
 * elsewhere (a preset, opening a project) show up whenever the field isn't being edited.
 */
export function NumberField({
  id,
  label,
  unit,
  value,
  onCommit,
  step,
  min = 0,
  accept = (v) => v > 0,
}: {
  id: string
  label: string
  unit: string
  value: number
  /** Called with accepted values as the user types; omit for a placeholder field. */
  onCommit?: (value: number) => void
  step: number
  min?: number
  /** Which values to commit. Default: positive. */
  accept?: (value: number) => boolean
}) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)
  const [shown, setShown] = useState(value)
  // Adjust state during render when the value changes from outside (React's recommended
  // alternative to an effect).
  if (value !== shown) {
    setShown(value)
    if (!focused) setDraft(String(value))
  }
  return (
    <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          value={draft}
          step={step}
          min={min}
          className="pr-9"
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setDraft(e.target.value)
            const v = e.target.valueAsNumber
            if (onCommit && Number.isFinite(v) && accept(v)) onCommit(v)
          }}
          onBlur={() => {
            setFocused(false)
            setDraft(String(value))
          }}
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  )
}
