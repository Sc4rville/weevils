import { defineMessages } from './index'

// How agents work (shared/api.ts AgentsChoice): Your factory > Intelligence > Agents (next/src/factory.tsx), and a
// session's own choice on its page (src/ui/session-agent-mode.tsx).
export default defineMessages({
  fr: {
    title: 'Agents',
    auto: 'Autonome',
    ask: 'Me demander',
    autoAria: 'Autonome (par défaut) : tes agents agissent sans te demander',
    askAria: 'Me demander : tes agents te demandent avant d’agir',
    /** Under the band, only while « Ask me » is on. */
    askLine: 'Tes agents te demandent avant d’agir : tu réponds depuis l’app.',
    /** weevils runs as root on the main machine: the choice is locked to « Ask me ». */
    rootLine: 'weevils tourne en root ici : Claude Code y demande toujours avant d’agir.',
    /** A session's page, in its settings: its own choice, the other way from what it does now. */
    sessionAsk: 'Me demander dans cette session',
    sessionAuto: 'Autonome dans cette session',
    /** In its status line, when it differs from the global choice; a tap opens its settings. */
    differs: (ask: boolean): string => (ask ? 'me demande avant d’agir' : 'autonome'),
    differsAria: 'Cette session a son propre réglage : le changer',
  },
  en: {
    title: 'Agents',
    auto: 'Autonomous',
    ask: 'Ask me',
    autoAria: 'Autonomous (default): your agents act without asking you',
    askAria: 'Ask me: your agents ask before acting',
    askLine: 'Your agents ask before acting: you answer from the app.',
    rootLine: 'weevils runs as root here: Claude Code always asks before acting there.',
    sessionAsk: 'Ask me in this session',
    sessionAuto: 'Autonomous in this session',
    differs: (ask: boolean): string => (ask ? 'asks before acting' : 'autonomous'),
    differsAria: 'This session has its own setting: change it',
  },
})
