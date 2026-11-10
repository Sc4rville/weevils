// The « auto » band's background tasks (server/optimizers.ts): the prompt that proposes them, the safety brief every
// accepted one starts with, and the short notes shown on a task that stopped.
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    /** Proposes up to `max` background tasks. Every block is already rendered (lines, or the "nothing yet" text). */
    propose: (user: string, max: number, memory: string, projects: string, repos: string, machine: string, history: string) =>
      `Tu proposes des tâches de fond à ${user}, l'utilisateur de weevils (l'app d'où il suit et pilote ses agents de code Claude Code et Codex depuis son téléphone). ` +
      `Quand ses agents ne travaillent pas, la machine dort : une tâche acceptée d'un tap tourne alors toute seule, dans une session Claude Code visible dans l'app, une à la fois, quand la machine est libre.\n\n` +
      `Ce que weevils sait de lui (ses objectifs, ses envies, ses projets) :\n${memory || '(rien encore)'}\n\n` +
      `Ses projets (les vrais, avec ce qui s'y fait ces jours-ci) :\n${projects || '(aucun)'}\n\n` +
      `Repos présents sur la machine (noms exacts) :\n${repos || '(aucun)'}\n\n` +
      `Machine : ${machine}\n\n` +
      `Déjà proposées (état entre crochets). Ne repropose jamais une tâche refusée ou faite, ni une proche ; les refus disent ce qu'il ne veut pas :\n${history || '(aucune)'}\n\n` +
      `Propose au plus ${max} tâche${max > 1 ? 's' : ''}, chacune :\n` +
      `- utile pour lui maintenant, concrète, ancrée dans un vrai projet ou un vrai souvenir ci-dessus (rien d'inventé, rien de générique du genre « améliorer le code ») ;\n` +
      `- bornée : une heure de travail d'agent au plus, avec un résultat clair (une branche locale à relire, ou un rapport) ;\n` +
      `- sûre : rien de destructif, rien de payant, rien de publié, posté ou envoyé ; tout ce qui sort de la machine attend sa validation ;\n` +
      `- d'un de ces genres : tests (muscler les tests, corriger un test cassé d'un repo), watch (veille sur un sujet qui l'intéresse, en lisant le web), content (préparer un brouillon : texte, page, doc), explore (prototyper ou étudier une idée qu'il a évoquée), other.\n` +
      `repo : seulement si la tâche doit lire ou changer le code de ce repo précis (sinon null) ; ne devine pas un repo à partir de son seul nom.\n` +
      `La consigne (prompt) ne choisit ni branche, ni worktree, ni fichier de sortie : weevils les fixe lui-même (branche locale à part, rapport dans un fichier donné) ; dis seulement quoi faire, quand s'arrêter et ce qu'il faut rendre.\n` +
      `S'il n'y a rien de vraiment utile, propose moins, ou rien.\n` +
      `Il lit title et why sur son téléphone : why lui parle directement, au tutoiement (par exemple : tu veux sortir mygame cette année), jamais à la troisième personne ; ni guillemets ni emoji dans title et why.\n\n` +
      `Réponds uniquement en JSON, une liste : [{"title": "très court, 5 mots au plus, en français, sans guillemets", "why": "une phrase en français qui la relie à un souvenir ou un projet, en lui parlant directement au tutoiement (tu, ton, tes ; jamais il, elle ni l'utilisateur), sans guillemets", "repo": "nom exact d'un repo ci-dessus, ou null", "kind": "tests|watch|content|explore|other", "heavy": true si builds, tests lourds ou installs, "priority": 1 (forte) à 3 (faible), "est": minutes environ, "prompt": "la consigne complète pour l'agent, en français : contexte, quoi faire, où, quand s'arrêter, ce qu'il rend"}]`,
    /** Machine facts for the prompt. */
    machine: (cpus: number, ramGb: number, os: string) => `${cpus} cœurs, ${ramGb} Go de RAM, ${os}`,
    /** One line of what was already proposed. */
    historyLine: (title: string, state: string, why: string) => `- [${state}] ${title}${why ? ` (${why})` : ''}`,
    state_proposed: 'proposée',
    state_queued: 'acceptée',
    state_running: 'en cours',
    state_done: 'faite',
    state_failed: 'échouée',
    state_refused: 'refusée',
    /**
     * First message of the agent session that runs an accepted task: the rules, then the brief. In a repo the session
     * already works in its own git worktree on `branch` (weevils made it); `checkout` is the user's own checkout, never
     * to touch. `report` is the file where watch/content/explore write their result. The technical deny list
     * (optimizers.ts DENY) backs these rules.
     */
    brief: (o: { title: string; branch: string; checkout: string; report: string; inRepo: boolean; writesReport: boolean; heavy: boolean; prompt: string }) =>
      `Tâche de fond lancée par weevils pendant que la machine est libre : « ${o.title} ». Personne ne te répond en direct : avance seul jusqu'au bout.\n\n` +
      `Règles, sans exception :\n` +
      (o.inRepo
        ? `- tu es dans ton propre worktree git, sur la branche locale ${o.branch} faite pour toi : travaille et committe uniquement ici, ne change pas de branche, jamais sur la branche principale ; ne touche pas au dossier ${o.checkout} (l'utilisateur s'en sert) ;\n`
        : `- travaille dans ce dossier seulement ;\n`) +
      `- ne pousse jamais, n'ouvre aucune PR, ne publie, ne poste et n'envoie rien (ni e-mail, ni message, ni déploiement) ;\n` +
      `- ne dépense rien : aucun achat, aucune API payante ;\n` +
      `- ne supprime rien en dehors de ta branche ou de ce dossier ; ne touche à aucun secret (clés, .env, identifiants) ;\n` +
      `- si \`command -v heavy\` répond, préfixe par \`heavy\` les commandes lourdes (builds, tests, installs)${o.heavy ? ' : cette tâche en a' : ''} ;\n` +
      (o.writesReport ? `- écris ton résultat dans ${o.report} (court, clair, en français) ;\n` : '') +
      `- reste dans le cadre : une heure de travail au plus ; ce qui demande une décision attend la validation de l'utilisateur.\n\n` +
      `La consigne :\n${o.prompt}\n\n` +
      `Termine par un résumé de deux phrases : ce qui a été fait, et ce qui attend sa validation.`,
    /** Notes shown on a task that stopped without finishing (the raw error stays in the server log). */
    vanished: 'la session a disparu',
    timedOut: 'arrêtée au bout de 2 h',
    startFailed: 'lancement impossible',
    branchFailed: 'branche impossible à créer',
    noWork: 'finie sans rien rendre',
    /** Stopped by Claude itself, back to the queue for later (or failed after a few tries). */
    stall_limit: "limite d'usage atteinte",
    stall_login: 'connexion à Claude à refaire',
    stall_api: "erreur de l'API Claude",
    noJail: 'pas de prison bwrap sur cette machine : la tâche attend Claude',
    /** Before the task's own brief, when Codex takes it over with an approved plan. */
    relayRules: 'Le cadre et la consigne d’origine de la tâche, toujours valables :',
  },
  en: {
    propose: (user: string, max: number, memory: string, projects: string, repos: string, machine: string, history: string) =>
      `You propose background tasks to ${user}, the user of weevils (the app from which they watch and drive their Claude Code and Codex coding agents from their phone). ` +
      `When their agents are not working, the machine sleeps: a task they accept with one tap then runs on its own, in a Claude Code session visible in the app, one at a time, when the machine is free.\n\n` +
      `What weevils knows about them (goals, wishes, projects):\n${memory || '(nothing yet)'}\n\n` +
      `Their projects (the real ones, with what has been going on lately):\n${projects || '(none)'}\n\n` +
      `Repos on the machine (exact names):\n${repos || '(none)'}\n\n` +
      `Machine: ${machine}\n\n` +
      `Already proposed (state in brackets). Never propose again a refused or done task, nor a close one; refusals tell what they don't want:\n${history || '(none)'}\n\n` +
      `Propose at most ${max} task${max > 1 ? 's' : ''}, each one:\n` +
      `- useful to them now, concrete, grounded in a real project or a real memory above (nothing made up, nothing generic like "improve the code");\n` +
      `- bounded: one hour of agent work at most, with a clear result (a local branch to review, or a report);\n` +
      `- safe: nothing destructive, nothing paid, nothing published, posted or sent; anything leaving the machine waits for their go;\n` +
      `- of one of these kinds: tests (harden a repo's tests, fix a broken test), watch (keep an eye on a topic they care about, reading the web), content (prepare a draft: text, page, doc), explore (prototype or study an idea they mentioned), other.\n` +
      `repo: only when the task must read or change the code of that very repo (else null); never guess a repo from its name alone.\n` +
      `The brief (prompt) picks no branch, worktree nor output file: weevils sets those itself (a separate local branch, a report in a given file); only say what to do, when to stop and what to hand back.\n` +
      `If nothing is really useful, propose fewer, or none.\n` +
      `They read title and why on their phone: why speaks to them directly as you (for example: you want to ship mygame this year), never in the third person; no quotes and no emoji in title and why.\n\n` +
      `Answer only in JSON, a list: [{"title": "very short, 5 words at most, in English, no quotes", "why": "one sentence in English tying it to a memory or a project, speaking to them directly as you (you, your; never they, he, she or the user), no quotes", "repo": "exact name of a repo above, or null", "kind": "tests|watch|content|explore|other", "heavy": true if builds, heavy tests or installs, "priority": 1 (high) to 3 (low), "est": rough minutes, "prompt": "the full brief for the agent, in English: context, what to do, where, when to stop, what it hands back"}]`,
    machine: (cpus: number, ramGb: number, os: string) => `${cpus} cores, ${ramGb} GB RAM, ${os}`,
    historyLine: (title: string, state: string, why: string) => `- [${state}] ${title}${why ? ` (${why})` : ''}`,
    state_proposed: 'proposed',
    state_queued: 'accepted',
    state_running: 'running',
    state_done: 'done',
    state_failed: 'failed',
    state_refused: 'refused',
    brief: (o: { title: string; branch: string; checkout: string; report: string; inRepo: boolean; writesReport: boolean; heavy: boolean; prompt: string }) =>
      `Background task started by weevils while the machine is free: "${o.title}". Nobody answers you live: carry on alone to the end.\n\n` +
      `Rules, no exception:\n` +
      (o.inRepo
        ? `- you are in your own git worktree, on the local branch ${o.branch} made for you: work and commit only here, never switch branch, never on the main branch; never touch the folder ${o.checkout} (the user works in it);\n`
        : `- work in this folder only;\n`) +
      `- never push, never open a PR, never publish, post or send anything (no e-mail, no message, no deploy);\n` +
      `- never spend money: no purchase, no paid API;\n` +
      `- never delete anything outside your branch or this folder; never touch a secret (keys, .env, credentials);\n` +
      `- if \`command -v heavy\` succeeds, prefix heavy commands (builds, tests, installs) with \`heavy\`${o.heavy ? ': this task has some' : ''};\n` +
      (o.writesReport ? `- write your result to ${o.report} (short and clear, in English);\n` : '') +
      `- stay in scope: one hour of work at most; anything that needs a decision waits for the user's go.\n\n` +
      `The brief:\n${o.prompt}\n\n` +
      `End with a two-sentence summary: what was done, and what awaits their validation.`,
    vanished: 'the session vanished',
    timedOut: 'stopped after 2 h',
    startFailed: 'could not start',
    branchFailed: 'could not make its branch',
    noWork: 'ended without any answer',
    stall_limit: 'usage limit reached',
    stall_login: 'Claude login needed',
    stall_api: 'Claude API error',
    noJail: 'no bwrap jail on this machine: the task waits for Claude',
    relayRules: 'The frame and the original brief of the task, still valid:',
  },
})
