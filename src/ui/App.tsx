import { Toaster } from '@/ui/components/ui/sonner'
import { TooltipProvider } from '@/ui/components/ui/tooltip'
import { CentrePanel } from '@/ui/layout/CentrePanel'
import { FacesPanel } from '@/ui/layout/FacesPanel'
import { LeftPanel } from '@/ui/layout/LeftPanel'
import { useProjectionSync } from '@/ui/useProjectionSync'

export default function App() {
  useProjectionSync()
  return (
    <TooltipProvider>
      <div className="grid h-screen grid-cols-[18rem_1fr_20rem] bg-background text-foreground">
        <LeftPanel />
        <CentrePanel />
        <FacesPanel />
      </div>
      <Toaster position="bottom-left" richColors />
    </TooltipProvider>
  )
}
