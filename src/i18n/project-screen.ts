import { defineMessages } from './index'

// The open project (src/ui/project-screen.tsx): what runs now, its to-do, its sessions. No headings: only these.
export default defineMessages({
  fr: {
    now: 'en ce moment',
    todo: 'à faire',
    more: (n: number) => `${n} de plus`,
    older: (n: number) => `${n} session${n > 1 ? 's' : ''} plus ancienne${n > 1 ? 's' : ''}`,
  },
  en: {
    now: 'right now',
    todo: 'to do',
    more: (n: number) => `${n} more`,
    older: (n: number) => `${n} older session${n === 1 ? '' : 's'}`,
  },
})
