import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/ui/App'
import { browserStorage, restoreAutosave, startAutosave } from '@/ui/persistence'

// Restore the previous session before the first render, then keep autosaving (plan §3).
const storage = browserStorage()
const restored = restoreAutosave(storage)
startAutosave(storage)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App startupNotes={restored.notes} />
  </StrictMode>,
)
