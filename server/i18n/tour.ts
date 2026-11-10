// Premiers pas (server/tour.ts) : ce que weevilsd écrit lui-même pendant les démos. Tout ce qui sort d'ici est marqué
// « démo » dans l'app ; les phrases vraies (résumé) sont composées à partir de l'état réel.
import { defineMessages } from '../i18n.ts'

const list = (xs: string[], and: string) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs.at(-1)}`)

export default defineMessages({
  fr: {
    summary: (working: number, waiting: number, projects: number, names: string[], sessions: number): string => {
      const now =
        working || waiting
          ? `${working ? `${working} session${working > 1 ? 's' : ''} travaille${working > 1 ? 'nt' : ''}` : ''}${working && waiting ? ', ' : ''}${waiting ? `${waiting} t’attend${waiting > 1 ? 'ent' : ''}` : ''}`
          : 'rien ne tourne en ce moment'
      const where = projects ? ` Tes projets : ${list(names, 'et')}${projects > names.length ? ` et ${projects - names.length} autre${projects - names.length > 1 ? 's' : ''}` : ''}.` : sessions ? ` J’ai retrouvé ${sessions} session${sessions > 1 ? 's' : ''} Claude Code sur cette machine.` : ''
      return `${now.charAt(0).toUpperCase()}${now.slice(1)}.${where}`
    },
    voiceDemo: (summary: string): string => `Salut ! Voilà comment je te parle quand tu marches. ${summary} Dis-moi ce que tu veux, je m’en occupe.`,
    mailDemoAsk: 'Salut weevboss, ici ChatGPT. Mon utilisateur me demande où en sont ses projets : tu peux me dire ?',
    mailDemoReply: (summary: string): string => `Bien reçu, ChatGPT. ${summary} Je te réponds par e-mail dès qu’il y a du nouveau.`,
    devilDemo:
      'Ici, c’est ton modèle à toi qui répondrait : Ollama ou LM Studio sur ton PC, un modèle ouvert chez OpenRouter… Même fil que weevboss, sans ses limites ; un tap sur le diablotin pour basculer.',
    jobStart: 'démo : je passe sur tes repos toutes les 6 secondes',
    jobRepo: (repo: string, n: number): string => (n < 0 ? `${repo} : illisible` : n ? `${repo} : ${n} fichier${n > 1 ? 's' : ''} modifié${n > 1 ? 's' : ''}` : `${repo} : rien de neuf`),
    jobTick: (i: number): string => `tour ${i + 1} : rien à surveiller pour l’instant`,
    jobEnd: (n: number): string => `démo finie : ${n} repo${n > 1 ? 's' : ''} surveillé${n > 1 ? 's' : ''}. Pour de vrai, ça tourne toute la nuit.`,
  },
  en: {
    summary: (working: number, waiting: number, projects: number, names: string[], sessions: number): string => {
      const now =
        working || waiting
          ? `${working ? `${working} session${working > 1 ? 's are' : ' is'} working` : ''}${working && waiting ? ', ' : ''}${waiting ? `${waiting} waiting for you` : ''}`
          : 'nothing is running right now'
      const where = projects ? ` Your projects: ${list(names, 'and')}${projects > names.length ? ` and ${projects - names.length} more` : ''}.` : sessions ? ` I found ${sessions} Claude Code session${sessions > 1 ? 's' : ''} on this machine.` : ''
      return `${now.charAt(0).toUpperCase()}${now.slice(1)}.${where}`
    },
    voiceDemo: (summary: string): string => `Hi! This is how I talk to you while you walk. ${summary} Tell me what you need, I'll handle it.`,
    mailDemoAsk: "Hi weevboss, ChatGPT here. My user wants to know how their projects are doing: can you tell me?",
    mailDemoReply: (summary: string): string => `Got it, ChatGPT. ${summary} I'll e-mail you as soon as there's news.`,
    devilDemo:
      'This is where your own model would answer: Ollama or LM Studio on your PC, an open model on OpenRouter… Same thread as weevboss, without its limits; one tap on the little devil to switch.',
    jobStart: 'demo: going over your repos every 6 seconds',
    jobRepo: (repo: string, n: number): string => (n < 0 ? `${repo}: unreadable` : n ? `${repo}: ${n} file${n > 1 ? 's' : ''} changed` : `${repo}: nothing new`),
    jobTick: (i: number): string => `round ${i + 1}: nothing to watch yet`,
    jobEnd: (n: number): string => `demo done: ${n} repo${n === 1 ? '' : 's'} watched. For real, it runs all night.`,
  },
})
