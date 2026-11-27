// The session rows of a project band in the side bar of weevils next (next/src/main.tsx ProjectGroup, side-rows.ts).
import { defineMessages } from './index'

export default defineMessages({
  fr: {
    untitled: 'Sans titre',
    // After an automation's name when its row holds several runs: « Veille des prix · 5 passages ».
    runs: (n: number) => `${n} passages`,
    done: (n: number) => `${n} terminée${n > 1 ? 's' : ''}`,
    hideDone: (n: number): string => (n > 1 ? 'Masquer les terminées' : 'Masquer la terminée'),
    // The pin of a drawer in the side bar (next/src/pin.tsx): a first tap asks, a second one unpins.
    unpin: 'Désépingler',
    unpinSure: 'Confirmer : désépingler',
    unpinAsk: 'retirer ?',
  },
  en: {
    untitled: 'Untitled',
    runs: (n: number) => `${n} runs`,
    done: (n: number) => `${n} done`,
    hideDone: (_n: number) => 'Hide done',
    unpin: 'Unpin',
    unpinSure: 'Confirm: unpin',
    unpinAsk: 'unpin?',
  },
})
