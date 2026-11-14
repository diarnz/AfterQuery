import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './ui/styles/tokens.css'
import './ui/styles/base.css'
import './ui/styles/components.css'
import './ui/styles/app.css'
import './ui/styles/harbor.css'
import { App } from './app/App'
import { RunLibrary } from './state/runLibrary'
import { browserStorage, tabStorage } from './state/storage'

const storage = browserStorage()
const library = new RunLibrary(storage)
const root = document.getElementById('root')
if (!root) throw new Error('The page is missing its #root element.')

createRoot(root).render(
  <StrictMode>
    <App library={library} storage={storage} tabStorage={tabStorage()} />
  </StrictMode>,
)
