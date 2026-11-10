import { TooltipProvider } from '@/ui/components/ui/tooltip'
import { CentrePanel } from '@/ui/layout/CentrePanel'
import { FacesPanel } from '@/ui/layout/FacesPanel'
import { LeftPanel } from '@/ui/layout/LeftPanel'

export default function App() {
  return (
    <TooltipProvider>
      <div className="grid h-screen grid-cols-[18rem_1fr_20rem] bg-background text-foreground">
        <LeftPanel />
        <CentrePanel />
        <FacesPanel />
      </div>
    </TooltipProvider>
  )
}
