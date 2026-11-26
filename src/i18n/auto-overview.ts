// An automation's overview in weevils next (next/src/auto.tsx): the words of its « Last run » fact.
import { defineMessages } from './index'

export default defineMessages({
  fr: {
    lastRun: 'Dernier passage',
    // The mark beside it (a check, a pause) says how it ended; these words say when, and that it stopped short.
    when: (ago: string, ok: boolean) => (ok ? `il y a ${ago}` : `il y a ${ago}, arrêté avant la fin`),
  },
  en: {
    lastRun: 'Last run',
    when: (ago: string, ok: boolean) => (ok ? `${ago} ago` : `${ago} ago, stopped early`),
  },
})
