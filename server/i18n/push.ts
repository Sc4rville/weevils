// Push notifications (server/push.ts, sent from server/core.ts and server/index.ts).
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    badSubscription: 'abonnement invalide',
    relayPlansBody: (names: string) => `Valide ou refuse la reprise de ces travaux : ${names}.`,
    /** A session started waiting for the user. */
    waitingTitle: (project: string) => `${project} t’attend`,
    waitingBody: 'attend ta réponse',
    /** A session finished a piece of work. */
    doneTitle: (project: string) => `${project} a fini`,
    /** A session was cut off mid-work (process killed, quota, API error). */
    cutTitle: (project: string) => `${project} : session coupée en plein travail`,
    testBody: 'Les notifications marchent. Je te préviens quand une session t’attend ou a fini.',
    /** The computer's quick tunnel restarted under a new address (server/tunnel-link.ts). */
    linkTitle: 'weevils a changé d’adresse',
    linkBody: (host: string) => `Ouvre ce lien pour retrouver l’app (${host}), puis ajoute-la de nouveau à l’écran d’accueil.`,
    /** The computer moved from the quick tunnel to its stable address (server/stable-address.ts). */
    stableTitle: 'weevils a maintenant une adresse fixe',
    stableBody: (host: string) => `Ouvre ce lien et ajoute l’app à l’écran d’accueil une dernière fois : ${host} ne changera plus, même quand l’ordinateur redémarre.`,
  },
  en: {
    badSubscription: 'invalid subscription',
    relayPlansBody: (names: string) => `Approve or decline resuming these tasks: ${names}.`,
    waitingTitle: (project: string) => `${project} needs you`,
    waitingBody: 'waiting for your answer',
    doneTitle: (project: string) => `${project} is done`,
    cutTitle: (project: string) => `${project}: session cut off mid-work`,
    testBody: 'Notifications work. I’ll ping you when a session needs you or is done.',
    linkTitle: 'weevils has a new address',
    linkBody: (host: string) => `Open this to get back to the app (${host}), then add it to your home screen again.`,
    stableTitle: 'weevils now has a permanent address',
    stableBody: (host: string) => `Open this and add the app to your home screen one last time: ${host} won’t change again, even when the computer restarts.`,
  },
})
