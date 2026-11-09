// Devil mode (server/devil.ts) : erreurs renvoyées à l'app.
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    notConnected: 'modèle non branché',
    empty: 'message vide',
    busy: 'il répond encore',
    failed: (why: string) => `(pas de réponse du modèle : ${why})`,
  },
  en: {
    notConnected: 'model not connected',
    empty: 'empty message',
    busy: 'still answering',
    failed: (why: string) => `(no answer from the model: ${why})`,
  },
})
