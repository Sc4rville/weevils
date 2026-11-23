import { defineMessages } from './index'

// The app's camera (next/src/camera.tsx): what a screen reader hears, and the one line said when a step fails, with what failed.
export default defineMessages({
  fr: {
    camera: 'Capturer l’écran',
    cancel: 'Annuler la capture',
    failed: 'Pas de capture. Réessaie.',
    failedMake: 'L’image de l’écran n’a pas pu être faite. Réessaie.',
    failedSlow: 'L’image de l’écran a pris trop de temps. Réessaie.',
    failedKeep: 'La capture n’a pas pu être jointe. Réessaie.',
    close: 'Fermer',
    shot: 'Capture',
    remove: 'Retirer la capture',
  },
  en: {
    camera: 'Capture the screen',
    cancel: 'Cancel the capture',
    failed: 'No capture. Try again.',
    failedMake: 'The picture of the screen could not be made. Try again.',
    failedSlow: 'The picture of the screen took too long. Try again.',
    failedKeep: 'The capture could not be attached. Try again.',
    close: 'Close',
    shot: 'Capture',
    remove: 'Remove the capture',
  },
})
