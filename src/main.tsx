import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Service worker : seulement pour les notifications (aucun cache).
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
