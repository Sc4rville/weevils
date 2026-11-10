import { defineMessages } from './index'

// src/ui/weevil.tsx: flying weevils. Only accessible labels: the question and the replies come from weevilsd.
export default defineMessages({
  fr: {
    catch: (q: string) => `attraper le weevil : ${q}`,
    answer: 'ta réponse',
    send: 'envoyer',
    close: 'laisser filer le weevil',
    learned: 'retenu',
  },
  en: {
    catch: (q: string) => `catch the weevil: ${q}`,
    answer: 'your answer',
    send: 'send',
    close: 'let the weevil go',
    learned: 'remembered',
  },
})
