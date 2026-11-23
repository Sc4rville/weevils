// Naming follows the explicit catalog locale, independently of the language of the conversation.
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    prompt: (user: string, sessions: string) =>
      [
        `Tu nommes des sessions d’agents de code (Claude Code, Codex) pour que ${user} comprenne d’un coup d’œil, sur son téléphone, de quoi chacune parle. Ne lis aucun fichier, ne lance aucune commande : réponds directement.`,
        '',
        'Pour chaque session, à partir de son début et de ses derniers échanges :',
        '- title : le TRAVAIL que fait la session, en une courte action humaine en français, 3 à 5 mots, ≤ 30 caractères pour tenir sur une ligne de téléphone, nom d’action (ex. « Refonte de la page des demandes », « Séparation public et perso », « Reconnexion des sessions », « Chargement du jeu plus rapide »). Jamais des mots repris tels quels de la demande (une demande qui parle de « vision d’architecture » pour refaire la page des demandes s’appelle « Refonte de la page des demandes », pas « vision d’architecture »). Jamais le nom du dépôt ou du projet en tête ni seul (pas « weevils next », pas « weevils fiabilité de la pompe », pas « projet weevils »). Pas de jargon, d’identifiant, de branche ni de nom de fichier ; sans point final, sans guillemets, sans « session » ni « conversation ».',
        '- now : la dernière chose faite ou en cours, ≤ 5 mots et ≤ 40 caractères (elle doit tenir sur une ligne de téléphone), en français, au présent, sans sujet, en mots simples sans identifiants, branches ni noms de fichiers (ex. « corrige le détecteur d’écran », « déploie sur le VPS »).',
        'Garde previousTitle mot pour mot s’il nomme déjà le travail par une action ; s’il ne nomme qu’un thème, un lieu ou des mots de la demande, écris le bon titre et mets topicChanged à true. Sinon topicChanged vaut true quand les derniers échanges portent sur un autre travail que celui que nomme previousTitle (une nouvelle demande sur un autre sujet, de l’utilisateur ou de qui pilote la session) : le titre suit alors le travail en cours. Une correction, un test, un déploiement ou une étape technique du même travail ne changent jamais le sujet. Sans previousTitle, nomme le sujet global selon tout le contexte.',
        '',
        'Écris un français naturel, pas un calque du chat. La langue du chat ne choisit pas celle du titre. Garde l’orthographe d’un nom de produit ou d’automatisation quand il est le sujet même du travail, sans en faire un préfixe.',
        'Sessions :',
        sessions,
      ].join('\n'),
    /** One session of the prompt, as JSON (keys in the prompt's language). */
    item: (id: string, tool: string, where: string, start: string, recent: string[], previousTitle?: string) =>
      JSON.stringify({ previousTitle, id, outil: tool, ou: where, debut: start, derniers_echanges: recent }),
    /** Without Codex (no output schema): the answer format, said in the prompt. */
    jsonOnly: 'Réponds uniquement avec ce JSON, sans rien autour : {"items":[{"id":"…","title":"…","now":"…","topicChanged":false}]}',
  },
  en: {
    prompt: (user: string, sessions: string) =>
      [
        `You name coding-agent sessions (Claude Code, Codex) so that ${user} can tell at a glance, on their phone, what each one is about. Don't read any file, don't run any command: answer directly.`,
        '',
        'For each session, from its beginning and its latest exchanges:',
        '- title: the WORK the session is doing, as a short human action phrase in English, 3 to 5 words, ≤ 30 characters so it fits one phone line, starting with a verb in -ing (e.g. "Remaking the requests page", "Splitting public from private", "Reconnecting cut sessions", "Speeding up game loading"). Never words lifted from the request (a request that mentions "architecture vision" to rebuild the requests page is "Remaking the requests page", not "Architecture vision"). Never the repository or project name as a prefix or alone (not "weevils next", not "weevils pump reliability", not "weevils project"). No jargon, ids, branch or file names; no final period, no quotes, no "session" or "conversation".',
        '- now: the last thing done or in progress, ≤ 5 words and ≤ 40 characters (it must fit on one phone line), in English, present tense, no subject, plain words with no ids, branch or file names (e.g. "fixes the screen detector", "deploys to the VPS").',
        'Keep previousTitle verbatim when it already names the work as an action; when it names only a theme, a place or words from the request, write the right title and set topicChanged to true. Otherwise topicChanged is true when the latest exchanges are about different work from what previousTitle names (a new request on another subject, from the user or whoever drives the session): the title then follows the current work. Fixes, tests, deployments and technical steps of the same work never change the topic. Without previousTitle, name the overall subject from the full context.',
        '',
        'Write natural English, not a literal rendering of chat phrasing. Chat language does not select title language. Keep the spelling of a product or automation name when it is the very subject of the work, never as a prefix.',
        'Sessions:',
        sessions,
      ].join('\n'),
    item: (id: string, tool: string, where: string, start: string, recent: string[], previousTitle?: string) =>
      JSON.stringify({ previousTitle, id, tool, where, start, latest_exchanges: recent }),
    jsonOnly: 'Answer with this JSON only, nothing around it: {"items":[{"id":"…","title":"…","now":"…","topicChanged":false}]}',
  },
})
