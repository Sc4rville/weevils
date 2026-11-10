// Memory (server/memory.ts): API errors and the marker of an unanswered question in prompts.
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    empty: 'souvenir vide',
    notFound: 'souvenir introuvable',
    noAnswer: ' (pas de réponse)',
  },
  en: {
    empty: 'empty memory',
    notFound: 'memory not found',
    noAnswer: ' (no answer)',
  },
})
