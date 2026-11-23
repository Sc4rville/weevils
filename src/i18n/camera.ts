import { defineMessages } from './index'

// The app's camera (next/src/camera.tsx): what a screen reader hears, and the one line said when no picture came.
export default defineMessages({
  fr: {
    camera: 'Capturer l’écran',
    cancel: 'Annuler la capture',
    failed: 'Pas de capture. Réessaie.',
    shot: 'Capture',
    remove: 'Retirer la capture',
  },
  en: {
    camera: 'Capture the screen',
    cancel: 'Cancel the capture',
    failed: 'No capture. Try again.',
    shot: 'Capture',
    remove: 'Remove the capture',
  },
})
