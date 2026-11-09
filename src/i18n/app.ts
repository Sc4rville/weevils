import { defineMessages } from './index'

// src/App.tsx, src/api.ts, src/push.ts: startup screen, API client and push subscription errors.
export default defineMessages({
  fr: {
    offline: 'serveur injoignable, nouvelle tentative…',
    connecting: 'connexion au serveur…',
    failed: (status: number) => `échec (${status})`,
    uploadInterrupted: 'envoi interrompu',
    pushUnavailable: 'notifications indisponibles sur le serveur',
    pushDenied: 'autorisation refusée (réglages de l’iPhone → weevils → notifications)',
  },
  en: {
    offline: 'can’t reach the server, retrying…',
    connecting: 'connecting to the server…',
    failed: (status: number) => `failed (${status})`,
    uploadInterrupted: 'upload interrupted',
    pushUnavailable: 'notifications aren’t available on the server',
    pushDenied: 'permission denied (iPhone Settings → weevils → Notifications)',
  },
})
