// Messages of server/transcripts.ts. Speaker labels go into the renamer's prompt material (digestOf).
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    subagent: 'sous-agent',
    task: 'tâche',
    newSession: 'nouvelle session',
    userLabel: 'utilisateur',
    said: (who: string, text: string) => `${who} : ${text}`,
  },
  en: {
    subagent: 'subagent',
    task: 'task',
    newSession: 'new session',
    userLabel: 'user',
    said: (who: string, text: string) => `${who}: ${text}`,
  },
})
