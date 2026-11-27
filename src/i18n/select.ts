import { defineMessages } from './index'

// Explain any text of the app (next/src/select.tsx): the phone's select mark, its frozen screen, its one hint line.
export default defineMessages({
  fr: {
    select: 'Sélectionner un texte pour l’expliquer',
    leave: 'Quitter la sélection',
    hint: 'Touche un mot, ou garde le doigt pour sélectionner',
  },
  en: {
    select: 'Select text to explain it',
    leave: 'Leave select mode',
    hint: 'Tap a word, or hold to select',
  },
})
