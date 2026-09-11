import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadAppSettings } from './api/app-settings-storage'
import { applyColorTheme } from './app/color-theme'
import './styles/tokens.css'
import './styles/tailwind.css'
import './styles/base.css'
import './styles/primitives.css'
import './styles/app-shell.css'

applyColorTheme(loadAppSettings().display.colorTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
