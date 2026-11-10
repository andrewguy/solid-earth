import { useEffect } from 'react'
import { toast } from 'sonner'

import { Toaster } from '@/ui/components/ui/sonner'
import { TooltipProvider } from '@/ui/components/ui/tooltip'
import { CentrePanel } from '@/ui/layout/CentrePanel'
import { FaceDialog } from '@/ui/layout/FaceDialog'
import { FacesPanel } from '@/ui/layout/FacesPanel'
import { LeftPanel } from '@/ui/layout/LeftPanel'
import { ProjectionSync } from '@/ui/useProjectionSync'

export default function App({ startupNotes = [] }: { startupNotes?: readonly string[] }) {
  // Tell the user about anything adjusted (or discarded) while restoring the last session.
  useEffect(() => {
    if (startupNotes.length > 0) {
      toast.warning('Previous session restored with changes', {
        id: 'startup-notes', // dedupes StrictMode's double effect in development
        description: startupNotes.join('; '),
        duration: 10000,
      })
    }
  }, [startupNotes])

  return (
    <TooltipProvider>
      <ProjectionSync />
      <div className="grid h-screen grid-cols-[24rem_minmax(0,1fr)_20rem] grid-rows-[minmax(0,1fr)] overflow-hidden bg-background text-foreground">
        <LeftPanel />
        <CentrePanel />
        <FacesPanel />
      </div>
      <FaceDialog />
      <Toaster position="bottom-left" richColors />
    </TooltipProvider>
  )
}
