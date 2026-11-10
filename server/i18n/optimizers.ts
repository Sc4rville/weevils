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
    brief: (o: { title: string; branch: string; checkout: string; report: string; inRepo: boolean; writesReport: boolean; heavy: boolean; prompt: string; minutes: number; agreed: string }) =>
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
      `- reste dans le cadre : ${o.minutes > 60 ? `environ ${o.minutes} min de travail au plus` : 'une heure de travail au plus'} ; ce qui demande une décision attend la validation de l'utilisateur.\n\n` +
      `La consigne :\n${o.prompt}\n\n` +
      (o.agreed ? `Ce qui a été convenu avec l'utilisateur avant de la valider (la consigne en tient déjà compte) :\n${o.agreed}\n\n` : '') +
      `Termine par un résumé de deux phrases : ce qui a été fait, et ce qui attend sa validation.`,
    // ------------------------------------------------------------ the negotiation (POST /api/optimizers/:id/talk)
    /**
     * One turn of the exchange about one task: the user asks (« c'est quoi ? », « fais-le plutôt la nuit ») and the
     * model answers, rewriting the task when asked. Every block is already rendered.
     */
    talk: (o: { user: string; state: string; rules: string; item: string; live: string; memory: string; projects: string; repos: string; machine: string; now: string; history: string; said: string; replyLang: string; appLang: string }) =>
      `Tu es weevils, l'app d'où ${o.user} suit ses agents de code depuis son téléphone. Il discute avec toi d'une tâche de fond (état : ${o.state}). ` +
      `C'est une négociation : tu réponds à ce qu'il demande et, s'il veut autre chose (quoi, quand, à quelle fréquence, avec quelle intensité, sur quel projet), tu réécris la tâche. C'est lui qui valide, jamais toi.\n\n` +
      `La tâche :\n${o.item}\n\n` +
      (o.live ? `${o.live}\n\n` : '') +
      `Ce que weevils sait de lui :\n${o.memory || '(rien encore)'}\n\n` +
      `Ses projets :\n${o.projects || '(aucun)'}\n\n` +
      `Repos présents sur la machine (noms exacts) :\n${o.repos || '(aucun)'}\n\n` +
      `Machine : ${o.machine}\n` +
      `Maintenant : ${o.now}\n\n` +
      (o.history ? `L'échange jusqu'ici :\n${o.history}\n\n` : '') +
      `Il dit maintenant : ${o.said}\n\n` +
      `Ce que tu peux changer dans cet état : ${o.rules}\n\n` +
      `Règles :\n` +
      `- reply : court (une à trois phrases), direct et concret, en ${o.replyLang}, en lui parlant au tutoiement s'il écrit en français ; « c'est quoi », « pourquoi », « tu ferais quoi exactement » : réponds à partir de la consigne, avec les vraies étapes et ce qu'il aura à la fin ; s'il change quelque chose, dis en une phrase ce qui a changé ; ni liste, ni emoji, ni guillemets autour des mots ;\n` +
      `- patch : seulement les champs qui changent, {} s'il ne demande aucun changement ; quand la portée change (quoi, sur quel projet), réécris prompt en entier, et title et why s'il le faut ; title, why et prompt restent en ${o.appLang} ;\n` +
      `- la tâche reste bornée et sûre : rien de destructif, de payant, de publié, posté ou envoyé (weevils ajoute lui-même ces règles au lancement : ne les recopie pas dans prompt) ; s'il demande l'un de ces gestes, dis-lui que la tâche préparera tout et que ce geste attendra son feu vert ;\n` +
      `- les heures se lisent dans son fuseau (celui de « maintenant ») ; « la nuit » : window "01:00-06:00" ; « chaque jour » : every "1d" ; « chaque semaine » : every "7d" ; « demain matin » : notBefore le lendemain à 08:00 ; « une seule fois » : every null.\n\n` +
      `Réponds uniquement en JSON : {"reply": "ta réponse", "patch": {"title": "5 mots au plus", "why": "une phrase au tutoiement", "est": minutes (5 à 240), "priority": 1 (forte) à 3 (faible), "heavy": true ou false, "kind": "tests|watch|content|explore|other", "repo": "nom exact d'un repo ci-dessus, ou null", "prompt": "la consigne complète pour l'agent", "notBefore": "AAAA-MM-JJ HH:MM" ou null (dès que possible), "window": "HH:MM-HH:MM" chaque jour ou null (n'importe quand), "every": "12h", "1d", "7d"… ou null (une seule fois)}}`,
    /** The task as the model reads it. */
    talkItem: (x: { title: string; why: string; kind: string; repo: string | null; est: number; priority: number; heavy: boolean; when: string; every: string; prompt: string }) =>
      `- title : ${x.title}\n- why : ${x.why || '(aucun)'}\n- kind : ${x.kind}\n- repo : ${x.repo ?? 'null (dans son propre dossier)'}\n- est : ${x.est} min\n- priority : ${x.priority}\n- heavy : ${x.heavy}\n- quand : ${x.when}\n- fréquence : ${x.every}\n- prompt (la consigne de l'agent) :\n<<<\n${x.prompt}\n>>>`,
    whenAsap: 'dès que la machine est libre',
    whenNotBefore: (at: string) => `pas avant ${at}`,
    whenWindow: (w: string) => `chaque jour entre ${w.replace('-', ' et ')}`,
    everyOnce: 'une seule fois',
    everyEvery: (d: string) => `toutes les ${d}`,
    /** What a running or finished task says, for the model. */
    liveRunning: (since: number, said: string) => `Elle tourne depuis ${since} min. Ce que l'agent dit en dernier :\n${said || '(rien encore)'}`,
    liveEnded: (state: string, note: string) => `Elle est ${state}. Sa dernière nouvelle : ${note || '(aucune)'}`,
    liveReport: (text: string) => `Son rapport (début) :\n${text}`,
    liveRuns: (lines: string) => `Ses passages précédents :\n${lines}`,
    runLine: (at: string, ok: boolean, note: string) => `- ${at} : ${ok ? 'faite' : 'échouée'}${note ? ` (${note})` : ''}`,
    /** What may change in each state (the server enforces it too). */
    rules_proposed: "tout ; c'est la version à l'écran qu'il validera d'un tap.",
    rules_queued: "tout : elle n'a pas encore démarré ; la nouvelle version partira à sa place.",
    rules_running:
      "elle tourne en ce moment dans sa propre session, que tu ne touches pas : quand, fréquence, intensité (est, priority, heavy) changent pour la suite ; un changement de portée (title, why, prompt, repo, kind) ne vaut que pour la prochaine fois, s'il y en a une (every) : dis-le-lui.",
    rules_ended: "rien (patch {}) : elle est finie ; réponds sur ce qu'elle a fait, et s'il veut la refaire autrement, dis-lui qu'une proposition reviendra.",
    /** The exchange, as the model reads it. */
    lineUser: (name: string, text: string) => `${name} : ${text}`,
    lineAuto: (text: string) => `toi : ${text}`,
    langName: (l: string): string => (l === 'en' ? 'anglais' : 'français'),
    /** What the agent reads at launch about the negotiation. */
    agreedUser: (text: string) => `- il a demandé : ${text}`,
    agreedAuto: (text: string) => `- réponse retenue : ${text}`,
    /** Replies when no model answers. */
    talkFailed: "Je n'arrive pas à réfléchir à ça pour l'instant. Rien n'a changé, redemande-moi dans un moment.",
    talkBusy: 'Je réponds déjà à ta question précédente.',
    /** Notes shown on a task that stopped without finishing (the raw error stays in the server log). */
    vanished: 'la session a disparu',
    timedOut: (h: number) => `arrêtée au bout de ${h} h`,
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
    brief: (o: { title: string; branch: string; checkout: string; report: string; inRepo: boolean; writesReport: boolean; heavy: boolean; prompt: string; minutes: number; agreed: string }) =>
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
      `- stay in scope: ${o.minutes > 60 ? `about ${o.minutes} min of work at most` : 'one hour of work at most'}; anything that needs a decision waits for the user's go.\n\n` +
      `The brief:\n${o.prompt}\n\n` +
      (o.agreed ? `What was agreed with the user before they approved it (the brief already reflects it):\n${o.agreed}\n\n` : '') +
      `End with a two-sentence summary: what was done, and what awaits their validation.`,
    talk: (o: { user: string; state: string; rules: string; item: string; live: string; memory: string; projects: string; repos: string; machine: string; now: string; history: string; said: string; replyLang: string; appLang: string }) =>
      `You are weevils, the app from which ${o.user} follows their coding agents on their phone. They are talking with you about a background task (state: ${o.state}). ` +
      `It is a negotiation: you answer what they ask and, when they want something else (what, when, how often, how intense, on which project), you rewrite the task. They approve it, never you.\n\n` +
      `The task:\n${o.item}\n\n` +
      (o.live ? `${o.live}\n\n` : '') +
      `What weevils knows about them:\n${o.memory || '(nothing yet)'}\n\n` +
      `Their projects:\n${o.projects || '(none)'}\n\n` +
      `Repos on the machine (exact names):\n${o.repos || '(none)'}\n\n` +
      `Machine: ${o.machine}\n` +
      `Now: ${o.now}\n\n` +
      (o.history ? `The exchange so far:\n${o.history}\n\n` : '') +
      `They now say: ${o.said}\n\n` +
      `What you may change in this state: ${o.rules}\n\n` +
      `Rules:\n` +
      `- reply: short (one to three sentences), direct and concrete, in ${o.replyLang}, speaking to them as you; "what is it", "why", "what exactly would you do": answer from the brief, with the real steps and what they get at the end; when something changes, say in one sentence what changed; no list, no emoji, no quotes around words;\n` +
      `- patch: only the fields that change, {} when they ask for no change; when the scope changes (what, which project), rewrite prompt in full, and title and why if needed; title, why and prompt stay in ${o.appLang};\n` +
      `- the task stays bounded and safe: nothing destructive, paid, published, posted or sent (weevils adds these rules itself at launch: don't copy them into prompt); if they ask for one of those acts, tell them the task will prepare everything and that act will wait for their go;\n` +
      `- times are read in their time zone (the one of "now"); "at night": window "01:00-06:00"; "every day": every "1d"; "every week": every "7d"; "tomorrow morning": notBefore the next day at 08:00; "just once": every null.\n\n` +
      `Answer only in JSON: {"reply": "your answer", "patch": {"title": "5 words at most", "why": "one sentence speaking to them as you", "est": minutes (5 to 240), "priority": 1 (high) to 3 (low), "heavy": true or false, "kind": "tests|watch|content|explore|other", "repo": "exact name of a repo above, or null", "prompt": "the full brief for the agent", "notBefore": "YYYY-MM-DD HH:MM" or null (as soon as possible), "window": "HH:MM-HH:MM" every day or null (any time), "every": "12h", "1d", "7d"… or null (just once)}}`,
    talkItem: (x: { title: string; why: string; kind: string; repo: string | null; est: number; priority: number; heavy: boolean; when: string; every: string; prompt: string }) =>
      `- title: ${x.title}\n- why: ${x.why || '(none)'}\n- kind: ${x.kind}\n- repo: ${x.repo ?? 'null (in its own folder)'}\n- est: ${x.est} min\n- priority: ${x.priority}\n- heavy: ${x.heavy}\n- when: ${x.when}\n- how often: ${x.every}\n- prompt (the agent's brief):\n<<<\n${x.prompt}\n>>>`,
    whenAsap: 'as soon as the machine is free',
    whenNotBefore: (at: string) => `not before ${at}`,
    whenWindow: (w: string) => `every day between ${w.replace('-', ' and ')}`,
    everyOnce: 'just once',
    everyEvery: (d: string) => `every ${d}`,
    liveRunning: (since: number, said: string) => `It has been running for ${since} min. What the agent said last:\n${said || '(nothing yet)'}`,
    liveEnded: (state: string, note: string) => `It is ${state}. Its last news: ${note || '(none)'}`,
    liveReport: (text: string) => `Its report (start):\n${text}`,
    liveRuns: (lines: string) => `Its previous runs:\n${lines}`,
    runLine: (at: string, ok: boolean, note: string) => `- ${at}: ${ok ? 'done' : 'failed'}${note ? ` (${note})` : ''}`,
    rules_proposed: 'everything; the version on screen is the one they approve with one tap.',
    rules_queued: 'everything: it has not started yet; the new version goes in its place.',
    rules_running:
      'it is running right now in its own session, which you never touch: when, how often and intensity (est, priority, heavy) change for what comes next; a change of scope (title, why, prompt, repo, kind) only applies to the next time, if there is one (every): tell them so.',
    rules_ended: 'nothing (patch {}): it is over; answer about what it did, and if they want it done differently, tell them a proposal will come back.',
    lineUser: (name: string, text: string) => `${name}: ${text}`,
    lineAuto: (text: string) => `you: ${text}`,
    langName: (l: string) => (l === 'fr' ? 'French' : 'English'),
    agreedUser: (text: string) => `- they asked: ${text}`,
    agreedAuto: (text: string) => `- answer kept: ${text}`,
    talkFailed: "I can't think this through right now. Nothing changed, ask me again in a moment.",
    talkBusy: 'I am still answering your previous question.',
    vanished: 'the session vanished',
    timedOut: (h: number) => `stopped after ${h} h`,
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
