import { defineMessages } from './index'

// A paused session (it stopped on its own: a crash, a limit, signed out): said calmly, in the theme's colours, never as
// an alarm (2026-11-26). The reason only when it tells the person something to do or to expect.
export default defineMessages({
  fr: {
    paused: 'En pause, on reprend ?',
    cutWhy: (reason: string) =>
      ({ died: '', dirty: 'des changements attendent d’être enregistrés', quota: 'la limite d’usage est atteinte pour l’instant', auth: 'il faut se reconnecter', api: 'le service a fait une pause' })[reason] ?? '',
    /** Le message brut de l'outil, replié. */
    cutDetail: 'détails',
    dismiss: 'laisser',
    /** Compte déconnecté : la connexion se fait dans le fil de weevboss (un lien, puis un code à coller). */
    signInAgain: 'me reconnecter',
    signInAria: (tool: string) => `reconnecter ${tool} dans le fil de weevboss`,
  },
  en: {
    paused: 'Paused, pick it back up?',
    cutWhy: (reason: string) =>
      ({ died: '', dirty: 'some changes are waiting to be saved', quota: 'the usage limit is reached for now', auth: 'it needs a fresh sign-in', api: 'the service took a break' })[reason] ?? '',
    cutDetail: 'details',
    dismiss: 'dismiss',
    signInAgain: 'sign in again',
    signInAria: (tool: string) => `sign ${tool} in again in weevboss’s thread`,
  },
})
