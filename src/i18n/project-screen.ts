import { defineMessages } from './index'

// A project's page (src/ui/project-screen.tsx): its sessions with their requests, then the finished sessions.
export default defineMessages({
  fr: {
    /** The page's title: whose requests these are. */
    requestsFor: (name: string) => `Demandes pour ${name}`,
    openAria: (name: string) => `ouvrir ${name}`,
    older: (n: number) => `${n} session${n > 1 ? 's' : ''} plus ancienne${n > 1 ? 's' : ''}`,
  },
  en: {
    requestsFor: (name: string) => `Requests for ${name}`,
    openAria: (name: string) => `open ${name}`,
    older: (n: number) => `${n} older session${n === 1 ? '' : 's'}`,
  },
})
