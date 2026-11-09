import { defineMessages } from './index'

// src/App.tsx, src/api.ts, src/push.ts: startup screen, API client and push subscription errors.
export default defineMessages({
  fr: {
    offline: 'VPS injoignable, nouvelle tentative…',
    connecting: 'connexion au VPS…',
    failed: (status: number) => `échec (${status})`,
    uploadInterrupted: 'envoi interrompu',
    pushUnavailable: 'notifications indisponibles sur le serveur',
    pushDenied: 'autorisation refusée (réglages de l’iPhone → weevils → notifications)',
  },
  en: {
    offline: 'can’t reach the VPS, retrying…',
    connecting: 'connecting to the VPS…',
    failed: (status: number) => `failed (${status})`,
    uploadInterrupted: 'upload interrupted',
    pushUnavailable: 'notifications aren’t available on the server',
    pushDenied: 'permission denied (iPhone Settings → weevils → Notifications)',
  },
})
