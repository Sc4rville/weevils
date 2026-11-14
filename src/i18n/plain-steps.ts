import { defineMessages } from './index'
// One short human line per action (session threads). No path, command, flag or tool name ever goes in here.
export default defineMessages({
  fr: {
    read: (s: string) => (s ? `Lit ${s}` : 'Lit un fichier'), readMany: 'Parcourt le code',
    search: 'Cherche dans le code',
    edit: (s: string) => (s ? `Modifie ${s}` : 'Modifie le code'), editMany: 'Modifie le code',
    write: (s: string) => (s ? `Crée ${s}` : 'Crée un fichier'), writeMany: 'Crée des fichiers',
    test: 'Lance les tests', build: 'Compile le projet', git: 'Vérifie le dépôt', install: 'Installe les dépendances',
    run: 'Lance une commande', web: 'Consulte le web', delegate: 'Confie une tâche à un assistant', plan: 'Met à jour son plan',
    ask: 'Te pose une question', skill: 'Applique une méthode', look: 'Regarde une image', wait: 'Attend un résultat',
    message: 'Coordonne le travail', other: 'Travaille dessus',
    code: (n: string) => `le code « ${n} »`, doc: (n: string) => `la doc « ${n} »`, settings: (n: string) => `les réglages « ${n} »`,
    count: (n: number) => ` · ${n}`, more: ' …',
    liveWaiting: 't’attend', liveStopped: 'interrompue', liveDone: 'terminée', liveIdle: 'au repos', liveLabel: (t: string) => `En ce moment : ${t}`,
    rawTitle: 'Action enregistrée', unverified: 'Aucun résultat enregistré : rien n’est affirmé sur son issue.',
    longReply: 'Un message détaillé de l’agent', longBrief: (n: string) => `Un message détaillé de ${n}`, longReplyOpen: 'Lire le message en entier',
  },
  en: {
    read: (s: string) => (s ? `Reads ${s}` : 'Reads a file'), readMany: 'Looks through the code',
    search: 'Searches the code',
    edit: (s: string) => (s ? `Edits ${s}` : 'Edits the code'), editMany: 'Edits the code',
    write: (s: string) => (s ? `Creates ${s}` : 'Creates a file'), writeMany: 'Creates files',
    test: 'Runs the tests', build: 'Builds the project', git: 'Checks the repository', install: 'Installs dependencies',
    run: 'Runs a command', web: 'Checks the web', delegate: 'Hands a task to a helper', plan: 'Updates its plan',
    ask: 'Asks you a question', skill: 'Applies a method', look: 'Looks at an image', wait: 'Waits for a result',
    message: 'Coordinates the work', other: 'Works on it',
    code: (n: string) => `the ${n} code`, doc: (n: string) => `the ${n} notes`, settings: (n: string) => `the ${n} settings`,
    count: (n: number) => ` · ${n}`, more: ' …',
    liveWaiting: 'waiting for you', liveStopped: 'stopped', liveDone: 'done', liveIdle: 'idle', liveLabel: (t: string) => `Right now: ${t}`,
    rawTitle: 'Recorded action', unverified: 'No result recorded: nothing is claimed about how it went.',
    longReply: 'A detailed message from the agent', longBrief: (n: string) => `A detailed message from ${n}`, longReplyOpen: 'Read the whole message',
  },
})
