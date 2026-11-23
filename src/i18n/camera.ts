import { defineMessages } from './index'

// The app's camera (next/src/camera.tsx): what a screen reader hears, and the one line of the send sheet.
export default defineMessages({
  fr: {
    camera: 'Capturer l’écran',
    cancel: 'Annuler la capture',
    line: 'Un mot avec ?',
    sendTo: (name: string) => `Envoyer à ${name}`,
    failed: 'Pas envoyé. Réessaie.',
    shot: 'Capture',
  },
  en: {
    camera: 'Capture the screen',
    cancel: 'Cancel the capture',
    line: 'A word with it?',
    sendTo: (name: string) => `Send to ${name}`,
    failed: 'Not sent. Try again.',
    shot: 'Capture',
  },
})
