import { defineMessages } from './index'

export default defineMessages({
  fr: {
    conversations: 'conversations',
    backToFeed: 'retour au fil',
    back: 'retour',
    options: 'options',
    working: 'travaille',
    yourTurn: 'à toi',
    background: (n: number) => `${n} en arrière-plan`,
    /** Le volet qui montre l'appli en cours de construction (pas pour weevboss). */
    seeApp: 'voir l’appli',
    closeApp: 'fermer l’appli',
    writeTo: (who: string) => `écris à ${who}`,
    messageTo: (who: string) => `message à ${who}`,
  },
  en: {
    conversations: 'conversations',
    backToFeed: 'back to the feed',
    back: 'back',
    options: 'options',
    working: 'working',
    yourTurn: 'your turn',
    background: (n: number) => `${n} in background`,
    seeApp: 'see the app',
    closeApp: 'close the app',
    writeTo: (who: string) => `write to ${who}`,
    messageTo: (who: string) => `message to ${who}`,
  },
})
