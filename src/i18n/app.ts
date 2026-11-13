import { defineMessages } from './index'

// src/App.tsx, src/api.ts, src/push.ts: startup screen, API client and push subscription errors.
export default defineMessages({
  fr: {
    offline: 'machine injoignable, nouvelle tentative…',
    connecting: 'connexion à ta machine…',
    failed: (status: number) => `échec (${status})`,
    uploadInterrupted: 'envoi interrompu',
    pushUnavailable: 'notifications indisponibles sur ta machine',
    pushDenied: 'autorisation refusée (réglages de l’iPhone → weevils → notifications)',
    /** weevboss's greeting on an empty thread (server/core.ts sends it in the server's language). */
    hello: 'Dis-moi quoi faire : je lis tes sessions, j’écris dedans, je te résume. Les détails sont dans les bandes en dessous si tu veux les suivre.',
  },
  en: {
    offline: 'can’t reach your machine, retrying…',
    connecting: 'connecting to your machine…',
    failed: (status: number) => `failed (${status})`,
    uploadInterrupted: 'upload interrupted',
    pushUnavailable: 'notifications aren’t available on your machine',
    pushDenied: 'permission denied (iPhone Settings → weevils → Notifications)',
    hello: 'Tell me what to do: I read your sessions, write in them, and sum things up for you. The details are in the bands below if you want to follow along.',
  },
})
