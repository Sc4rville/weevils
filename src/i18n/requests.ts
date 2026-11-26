import { defineMessages } from './index'

// The requests page (src/ui/requests.tsx): weevboss's request ledger, goals and work trace.
export default defineMessages({
  fr: {
    title: 'demandes',
    /** Une session envoyée sans nom connu. */
    aSession: 'une session',
    menu: 'demandes',
    sessions: (n: number) => `${n} session${n > 1 ? 's' : ''}`,
    nothingOpen: 'aucune demande',
    open: 'ouverte',
    sentTo: (who: string) => `envoyée à ${who}`,
    waitsForYou: 'attend ta réponse',
    failed: 'bloquée',
    partly: 'en partie',
    done: 'faite',
    dropped: 'abandonnée',
    markDone: '✓ faite',
    drop: 'x abandonner',
    sure: 'vraiment ?',
    reopen: '↺ rouvrir',
    close: 'refermer',
    chip: (k: string) => ({ queued: 'pas commencée', running: 'en cours', blocked: 'bloquée', needs: 't’attend', check: 'à vérifier', paused: 'en pause', done: 'faite', dropped: 'abandonnée' })[k] ?? k,
    /** Le commit qui montre la demande faite. */
    commit: (id: string) => `commit ${id}`,
    earlier: (n: number) => `plus anciennes · ${n}`,
    /** The group of requests never sent to a session, at the bottom of a repo's page. */
    notSent: 'pas encore envoyées',
    moreDone: (n: number) => `${n} de plus, finie${n > 1 ? 's' : ''}`,
    openSession: 'ouvrir la session',
    /** Sous « demandes » dans la barre latérale de next (next/src/requests-band.tsx) : celles qui attendent la personne. */
    needYou: (n: number) => `${n} t’attend${n > 1 ? 'ent' : ''}`,
    /** La même bande, lue à voix haute : son nom, combien sont ouvertes, combien attendent. */
    bandLabel: (open: number, waiting: number) => ['demandes', ...(open ? [`${open} ouverte${open > 1 ? 's' : ''}`] : []), ...(waiting ? [`${waiting} t’attend${waiting > 1 ? 'ent' : ''}`] : [])].join(', '),
    /** Son interrupteur dans « Your factory ». */
    inSideBar: 'demandes dans la barre latérale',
  },
  en: {
    title: 'requests',
    aSession: 'a session',
    menu: 'requests',
    sessions: (n: number) => `${n} session${n === 1 ? '' : 's'}`,
    nothingOpen: 'no request yet',
    open: 'open',
    sentTo: (who: string) => `sent to ${who}`,
    waitsForYou: 'waits for you',
    failed: 'blocked',
    partly: 'partly done',
    done: 'done',
    dropped: 'dropped',
    markDone: '✓ done',
    drop: 'x drop',
    sure: 'really?',
    reopen: '↺ reopen',
    close: 'close',
    chip: (k: string) => ({ queued: 'not started', running: 'in progress', blocked: 'stuck', needs: 'needs you', check: 'to check', paused: 'paused', done: 'done', dropped: 'dropped' })[k] ?? k,
    commit: (id: string) => `commit ${id}`,
    earlier: (n: number) => `earlier · ${n}`,
    notSent: 'not sent yet',
    moreDone: (n: number) => `${n} more, finished`,
    openSession: 'open the session',
    needYou: (n: number) => `${n} need${n === 1 ? 's' : ''} you`,
    bandLabel: (open: number, waiting: number) => ['requests', ...(open ? [`${open} open`] : []), ...(waiting ? [`${waiting} need${waiting === 1 ? 's' : ''} you`] : [])].join(', '),
    inSideBar: 'requests in the side bar',
  },
})
