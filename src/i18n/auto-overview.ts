// An automation's page in weevils next (next/src/auto.tsx): its state, its times, what it last made, its past runs,
// its switch and its delete. Plain words, no ids, nothing alarming.
import { defineMessages } from './index'

export default defineMessages({
  fr: {
    // The line under its name: its state, and what that means for its next run.
    running: (d: string) => `En train de tourner, depuis ${d}`,
    nextAt: (when: string, inT: string) => `Activée · prochain passage ${when}, dans ${inT}`,
    nextSleep: 'Activée · prochain passage quand tu dors',
    onWhen: (cond: string) => `Activée · prochain passage ${cond}`,
    paused: 'En pause jusqu’à ce que tu la réactives',
    stopped: 'Arrêtée : ses derniers passages n’ont pas abouti',
    over: (ago: string) => `A tourné une fois, il y a ${ago}`,
    overNever: 'Terminée',
    switchOn: (title: string) => `Réactiver ${title}`,
    switchOff: (title: string) => `Mettre ${title} en pause`,
    lastRun: 'Dernier passage',
    // The mark beside it (a check, a pause) says how it ended; these words say when, and that it stopped short.
    when: (ago: string, ok: boolean) => (ok ? `il y a ${ago}` : `il y a ${ago}, arrêté avant la fin`),
    pastRuns: 'Passages précédents',
    // Delete, with one confirm in place.
    delete: 'Supprimer cette automatisation',
    deleteAsk: (title: string) => `Supprimer ${title} ? Ce qu’elle a déjà fait reste là.`,
    deleteYes: 'Supprimer',
    deleteNo: 'Garder',
    deleteFailed: 'Pas pu la supprimer. Elle est toujours là, réessaie.',
    switchFailed: 'Pas pu changer son état. Réessaie.',
  },
  en: {
    running: (d: string) => `Running now, for ${d}`,
    nextAt: (when: string, inT: string) => `On · next run ${when}, in ${inT}`,
    nextSleep: 'On · next run when you go to sleep',
    onWhen: (cond: string) => `On · next run ${cond}`,
    paused: 'Paused until you switch it back on',
    stopped: 'Stopped: its last runs didn’t finish',
    over: (ago: string) => `Ran once, ${ago} ago`,
    overNever: 'Finished',
    switchOn: (title: string) => `Switch ${title} back on`,
    switchOff: (title: string) => `Pause ${title}`,
    lastRun: 'Last run',
    when: (ago: string, ok: boolean) => (ok ? `${ago} ago` : `${ago} ago, stopped early`),
    pastRuns: 'Earlier runs',
    delete: 'Delete this automation',
    deleteAsk: (title: string) => `Delete ${title}? What it already made stays.`,
    deleteYes: 'Delete',
    deleteNo: 'Keep it',
    deleteFailed: 'Couldn’t delete it. It’s still here, try again.',
    switchFailed: 'Couldn’t change it. Try again.',
  },
})
