import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import App from './app/App.jsx'

// Force @monaco-editor/react to use the locally installed monaco-editor package
// instead of loading from CDN. This fixes the version mismatch with y-monaco@0.1.6
// which was built against monaco-editor@0.34.x internals.
loader.config({ monaco })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
