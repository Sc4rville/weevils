// Threads in the app (src/ui/threads.tsx, behind WEEVILS_THREADS): one conversation, three states, the sentence of a
// paused thread, and the weevbook page. Nothing here names an engine, an account or a relay: only what the person needs
// to act.
import { defineMessages } from './index'

export default defineMessages({
  fr: {
    working: 'en cours',
    waiting: 'à toi',
    paused: 'en pause',
    until: (when: string) => `reprend à ${when}`,
    /** The one sentence of a paused thread, when the person must act. */
    noMachine: (where?: string) => (where ? `Allume ${where} pour continuer.` : 'Aucune machine ne peut continuer ce projet : allume celle qui l’a.'),
    notSignedIn: (provider: string, machine?: string) => `Connecte ${provider}${machine ? ` sur ${machine}` : ''} pour continuer.`,
    onlyThere: (machine?: string) => `Le code de cette conversation n’est que sur ${machine ?? 'une autre machine'} : allume-la pour continuer.`,
    attempts: 'Ça s’est arrêté trois fois de suite.',
    expired: 'Cette demande a attendu plus d’une heure sans machine : elle a été laissée de côté.',
    /** A turn that will never go on by itself (before threads were on, or left too long). */
    stopped: 'Arrêté avant cette version : écris à nouveau pour continuer.',
    askAgain: 'redemander',
    continue: 'continuer',
    write: 'écrire à la suite',
    composerLabel: (title: string) => `écrire dans « ${title} »`,
    /** The page's title and the line that opens it: the person's conversations, never the store's own name. */
    weevbook: 'conversations',
    weevbookAria: (project: string) => `toutes les conversations de ${project}`,
    allProjects: 'tous les projets',
    search: 'chercher dans les conversations',
    none: 'Aucune conversation.',
    noMatch: 'Rien ne correspond.',
    reading: 'lecture…',
    untitled: 'sans titre',
  },
  en: {
    working: 'working',
    waiting: 'your move',
    paused: 'paused',
    until: (when: string) => `goes on at ${when}`,
    noMachine: (where?: string) => (where ? `Turn on ${where} to continue.` : 'No machine can continue this project: turn on the one that has it.'),
    notSignedIn: (provider: string, machine?: string) => `Sign in to ${provider}${machine ? ` on ${machine}` : ''} to continue.`,
    onlyThere: (machine?: string) => `The code of this conversation is only on ${machine ?? 'another machine'}: turn it on to continue.`,
    attempts: 'It stopped three times in a row.',
    expired: 'This request waited more than an hour with no machine: it was set aside.',
    stopped: 'Stopped before this version: write again to continue.',
    askAgain: 'ask again',
    continue: 'continue',
    write: 'write next',
    composerLabel: (title: string) => `write in “${title}”`,
    weevbook: 'conversations',
    weevbookAria: (project: string) => `every ${project} conversation`,
    allProjects: 'all projects',
    search: 'search the conversations',
    none: 'No conversation.',
    noMatch: 'Nothing matches.',
    reading: 'reading…',
    untitled: 'untitled',
  },
})
