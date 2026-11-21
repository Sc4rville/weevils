import { defineMessages } from './index'

// A project's page (src/ui/project-screen.tsx): its requests (the request column), then its sessions.
export default defineMessages({
  fr: {
    openAria: (name: string) => `ouvrir ${name}`,
    older: (n: number) => `${n} session${n > 1 ? 's' : ''} plus ancienne${n > 1 ? 's' : ''}`,
  },
  en: {
    openAria: (name: string) => `open ${name}`,
    older: (n: number) => `${n} older session${n === 1 ? '' : 's'}`,
  },
})
