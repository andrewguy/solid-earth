import { Toaster } from '@/ui/components/ui/sonner'
import { TooltipProvider } from '@/ui/components/ui/tooltip'
import { CentrePanel } from '@/ui/layout/CentrePanel'
import { FaceDialog } from '@/ui/layout/FaceDialog'
import { FacesPanel } from '@/ui/layout/FacesPanel'
import { LeftPanel } from '@/ui/layout/LeftPanel'
import { ProjectionSync } from '@/ui/useProjectionSync'

export default function App() {
  return (
    <TooltipProvider>
      <ProjectionSync />
      <div className="grid h-screen grid-cols-[18rem_1fr_20rem] bg-background text-foreground">
        <LeftPanel />
        <CentrePanel />
        <FacesPanel />
      </div>
      <FaceDialog />
      <Toaster position="bottom-left" richColors />
    </TooltipProvider>
  )
}
