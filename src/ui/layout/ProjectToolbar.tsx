import { FilePlus, FolderOpen, Save } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  ProjectFileError,
  parseProject,
  projectFileName,
  serializeProject,
} from '@/core/export/project-file'
import { DEFAULT_SETTINGS } from '@/core/settings'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { downloadText } from '@/ui/download'
import { selectSettings, useAppStore } from '@/ui/store'

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Open / save / new project (plan §3 Persistence). Work is also autosaved in the browser. */
export function ProjectToolbar() {
  const applySettings = useAppStore((s) => s.applySettings)
  const fileInput = useRef<HTMLInputElement>(null)
  const [confirmNew, setConfirmNew] = useState(false)

  function save() {
    const settings = selectSettings(useAppStore.getState())
    downloadText(projectFileName(settings), serializeProject(settings), 'application/json')
  }

  async function open(file: File) {
    try {
      const { settings, notes } = parseProject(await file.text())
      applySettings(settings)
      toast.success(`Opened ${file.name}`, {
        description: notes.length > 0 ? `Adjusted: ${notes.join('; ')}` : undefined,
        duration: notes.length > 0 ? 10000 : 4000,
      })
    } catch (err) {
      const message = err instanceof ProjectFileError ? err.message : String(err)
      toast.error(`Could not open ${file.name}`, { description: message, duration: 10000 })
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void open(file)
        }}
      />
      <ToolButton label="Open project…" onClick={() => fileInput.current?.click()}>
        <FolderOpen />
      </ToolButton>
      <ToolButton label="Save project" onClick={save}>
        <Save />
      </ToolButton>
      <ToolButton label="New project" onClick={() => setConfirmNew(true)}>
        <FilePlus />
      </ToolButton>
      <Dialog open={confirmNew} onOpenChange={setConfirmNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a new project?</DialogTitle>
            <DialogDescription>
              All settings go back to the defaults. Save the current project first if you want to
              keep it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNew(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                save()
              }}
            >
              <Save /> Save first
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                applySettings(DEFAULT_SETTINGS)
                setConfirmNew(false)
              }}
            >
              New project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
