// The curator of the « for you » stream (server/foryou-curator.ts): the prompts of what a model writes (weevboss's
// recap, a way to serve the user better, a « did you know » about a repo and its longer answer, the one-line summary of
// a mail) and the texts of what is counted without a model (milestones, the « where the day stands » bars).
// Every block passed to a prompt is already rendered (lines, or empty).
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    // ---------------------------------------------------------------- the digest (weevboss's voice)
    /** One session of the recap: project, title, what it said last. */
    line: (project: string, title: string, text: string) => `- [${project}] ${title}${text ? ` : ${text}` : ''}`,
    /** The figures of the period, one line. */
    counts: (c: { delivered: number; started: number; asking: number; cut: number; mails: number; autoDone: number; autoFailed: number; posts: number }) =>
      [
        `${c.delivered} tour${c.delivered > 1 ? 's' : ''} livré${c.delivered > 1 ? 's' : ''}`,
        `${c.started} session${c.started > 1 ? 's' : ''} lancée${c.started > 1 ? 's' : ''}`,
        `${c.asking} qui attend${c.asking > 1 ? 'ent' : ''} une réponse`,
        `${c.cut} coupée${c.cut > 1 ? 's' : ''}`,
        `${c.mails} mail${c.mails > 1 ? 's' : ''} reçu${c.mails > 1 ? 's' : ''}`,
        `${c.autoDone} tâche${c.autoDone > 1 ? 's' : ''} auto finie${c.autoDone > 1 ? 's' : ''}`,
        `${c.autoFailed} tâche${c.autoFailed > 1 ? 's' : ''} auto échouée${c.autoFailed > 1 ? 's' : ''}`,
        `${c.posts} mot${c.posts > 1 ? 's' : ''} déjà posté${c.posts > 1 ? 's' : ''} par weevboss`,
      ].join(', '),
    digest: (o: { user: string; memory: string; done: string; waiting: string; counts: string; earlier: string }) =>
      `Tu es weevboss, le chef d'orchestre des agents de code de ${o.user} dans weevils (l'app d'où il suit et pilote ses sessions Claude Code et Codex depuis son téléphone). ` +
      `Tu lui écris un mot dans son flux « pour toi » : le point sur ce qui s'est passé depuis ton dernier mot, comme un chef d'équipe qui passe la tête par la porte.\n\n` +
      `Ce qui est revenu (projet, session, ses derniers mots) :\n${o.done || '(rien)'}\n\n` +
      `Ce qui l'attend, lui (une question, une session coupée) :\n${o.waiting || '(rien)'}\n\n` +
      `En chiffres : ${o.counts}\n\n` +
      `Ce que tu sais de lui (ses objectifs, ses envies) :\n${o.memory || '(rien encore)'}\n\n` +
      `Tes derniers mots (ne te répète pas, ni sur le fond ni sur la tournure) :\n${o.earlier || '(aucun)'}\n\n` +
      `Écris :\n` +
      `- text : le point, en deux à quatre phrases, à l'oral, au tutoiement, comme tu lui parlerais (par exemple : ok, X est parti, Y est revenu, Z t'attend). Cite les vrais noms de projets et de sessions ci-dessus. Dis ce qui compte, pas tout : ce qui est livré, ce qui bloque, ce qui l'attend. Aucune formule creuse (pas de « belle progression », « tout avance bien », « n'hésite pas »), pas de liste, pas de titre, pas d'emoji, aucun chiffre qui n'est pas ci-dessus.\n` +
      `- thought : une seule phrase qui le fait réfléchir, seulement si tu as quelque chose de vrai à dire à partir de ce qui est ci-dessus, de préférence reliée à un de ses objectifs (par exemple : en fait quand t'y penses…, ou : bon, je pense qu'il y a un souci sur…). Rien de vrai à dire : pas de thought.\n` +
      `- actions : zéro, une ou deux suites utiles qu'il lancerait d'un tap ; label très court (4 mots au plus), brief = la consigne complète que tu recevras s'il tape (quoi faire, sur quelle session ou quel projet). Aucune action évidente : pas d'actions.\n\n` +
      `Réponds uniquement en JSON : {"text": "…", "thought": "…", "actions": [{"label": "…", "brief": "…"}]} (thought et actions facultatifs), en français.`,

    // ---------------------------------------------------------------- improve
    patProjects: (list: string) => `Sessions par projet (14 derniers jours) : ${list}`,
    patHours: (o: { morning: number; afternoon: number; evening: number; night: number }) => `Quand elles finissent leurs tours : matin ${o.morning}, après-midi ${o.afternoon}, soirée ${o.evening}, nuit ${o.night}`,
    patCuts: (n: number, why: string) => `Sessions coupées en plein travail : ${n}${why ? ` (${why})` : ''}`,
    patWaited: (n: number) => `Questions d'agents restées plus de 30 min sans réponse : ${n}`,
    patAuto: (o: { done: number; failed: number; unanswered: number }) => `Tâches auto : ${o.done} finies, ${o.failed} échouées, ${o.unanswered} propositions sans réponse`,
    patUnused: (list: string) => `Briques de weevils pas encore branchées : ${list}`,
    patAdvice: (list: string) => `Conseils de la page machine :\n${list}`,
    brick_voice: 'la voix (écouter les réponses)',
    brick_dictation: 'la dictée',
    brick_github: 'GitHub',
    improve: (o: { user: string; patterns: string; earlier: string }) =>
      `Tu regardes comment ${o.user} se sert de weevils (l'app d'où il suit et pilote ses agents de code Claude Code et Codex depuis son téléphone, avec weevboss qui dispatche pour lui) et tu lui proposes UNE façon concrète pour que weevils le serve mieux.\n\n` +
      `Ce qui a été mesuré (rien d'autre n'est su) :\n${o.patterns}\n\n` +
      `Déjà proposé (ne repropose ni la même idée ni une proche) :\n${o.earlier || '(rien)'}\n\n` +
      `Une seule idée, tirée d'un chiffre ci-dessus et qui le cite : une habitude à prendre avec weevboss, un réglage, une brique à brancher, une routine à lui confier. Rien de générique, rien qui demande un outil que weevils n'a pas, rien de payant. Si rien ne ressort vraiment des chiffres, réponds {}.\n\n` +
      `Réponds uniquement en JSON, en français : {"title": "5 mots au plus, sans guillemets", "text": "deux phrases au plus, au tutoiement : ce que tu as vu, ce que tu proposes", "action": {"label": "le bouton, 4 mots au plus", "brief": "la consigne complète pour weevboss s'il accepte : quoi mettre en place, où, comment vérifier"}}`,

    // ---------------------------------------------------------------- insight
    factsDeps: (list: string) => `Dépendances déclarées : ${list}`,
    factsFiles: (list: string) => `Fichiers à la racine : ${list}`,
    factsCommits: (list: string) => `Derniers commits :\n${list}`,
    factsLast: (title: string, text: string) => `Ce qu'un agent vient d'y faire : ${title}${text ? ` : ${text}` : ''}`,
    insight: (o: { repo: string; facts: string; earlier: string }) =>
      `Voici ce qu'il y a vraiment dans le repo « ${o.repo} », sur lequel des agents de code travaillent aujourd'hui pour leur utilisateur (qui les pilote depuis son téléphone et ne lit pas tout le code) :\n\n${o.facts}\n\n` +
      `Déjà dit (ne le redis pas) :\n${o.earlier || '(rien)'}\n\n` +
      `Écris UN « tu savais que » sur un outil, une bibliothèque ou une technique réellement présents ci-dessus : quelque chose de vrai et d'utile à savoir pour mieux diriger ses agents, relié si possible à ce qu'ils viennent de faire. ` +
      `Uniquement des faits bien établis, que tu affirmerais sans vérifier ; aucun chiffre, aucune date ni numéro de version dont tu n'es pas certain ; rien sur ce que tu ne vois pas ci-dessus. Si rien de sûr ne mérite d'être dit, réponds {}.\n\n` +
      `Réponds uniquement en JSON, en français : {"about": "le nom exact de l'outil, de la bibliothèque ou de la technique", "text": "une ou deux phrases, 220 caractères au plus, au tutoiement, sans guillemets ni emoji"}`,
    more: (o: { repo: string; text: string; facts: string }) =>
      `Dans son flux, l'utilisateur de weevils a lu ceci à propos de son repo « ${o.repo} » et veut en savoir plus :\n« ${o.text} »\n\n` +
      (o.facts ? `Ce qu'il y a dans le repo :\n${o.facts}\n\n` : '') +
      `Explique-lui en un paragraphe (900 caractères au plus), au tutoiement, simplement : ce que c'est, pourquoi ça compte dans ce repo, et ce qu'il peut demander à ses agents pour en tirer parti. ` +
      `Uniquement des faits bien établis ; aucun chiffre ni date dont tu n'es pas certain. Du texte simple : pas de titre, pas de liste, pas de markdown, pas d'emoji. En français.`,

    // ---------------------------------------------------------------- mail lines
    mailItem: (n: number, from: string, subject: string, text: string) => `### ${n}\nDe : ${from}\nObjet : ${subject || '(sans objet)'}\n${text}`,
    resultItem: (n: number, project: string, title: string, text: string) => `### ${n}\nDe : l'agent de code du projet ${project} (sa tâche : ${title || 'sans titre'})\nSon compte rendu de fin de tour :\n${text}`,
    mailLines: (mails: string) =>
      `Voici des messages reçus par l'utilisateur d'une app qui pilote des agents de code (des mails, des comptes rendus d'agents). Pour chacun, écris UNE ligne très courte (90 caractères au plus) qui dit ce que l'expéditeur a fait, annonce ou demande, à la première personne, comme il le dirait lui-même en passant à un humain (par exemple : j'ai fini le menu, il reste les tests ; j'ai trouvé pourquoi les sessions se fermaient, c'est réparé). ` +
      `Pas de salutation, pas de guillemets, pas d'emoji, aucun chemin de fichier, aucune commande, aucun nom de fonction ni jargon technique inutile, rien qui n'est pas dans le message ; dans la langue du message.\n\n${mails}\n\n` +
      `Réponds uniquement en JSON, une liste : [{"n": 1, "line": "…"}]`,

    // ---------------------------------------------------------------- milestones (no model)
    msTurns: (n: number) => `${n} tours livrés aujourd’hui`,
    msProjects: (n: number) => `${n} projets ont avancé aujourd’hui`,
    msAutoFirst: 'Première tâche auto finie toute seule',
    msStreak: (n: number) => `${n} jours d’affilée avec des tours livrés`,

    // ---------------------------------------------------------------- where the day stands (no model)
    statText: (n: number) => (n > 0 ? `Où en est la journée : ${n} tour${n > 1 ? 's' : ''} livré${n > 1 ? 's' : ''}` : 'Où en est la journée'),
    statUsage: (window: string) => `Claude · ${window}`,
    percent: (n: number) => `${n} %`,
    statTurns: (n: number, total: number) => `${n} sur ${total}`,
    statAuto: 'File auto',
    statAutoShown: (running: number, queued: number) => `${running} en cours, ${queued} en attente`,
  },
  en: {
    line: (project: string, title: string, text: string) => `- [${project}] ${title}${text ? `: ${text}` : ''}`,
    counts: (c: { delivered: number; started: number; asking: number; cut: number; mails: number; autoDone: number; autoFailed: number; posts: number }) =>
      [
        `${c.delivered} turn${c.delivered === 1 ? '' : 's'} delivered`,
        `${c.started} session${c.started === 1 ? '' : 's'} started`,
        `${c.asking} waiting for an answer`,
        `${c.cut} cut off`,
        `${c.mails} mail${c.mails === 1 ? '' : 's'} received`,
        `${c.autoDone} auto task${c.autoDone === 1 ? '' : 's'} done`,
        `${c.autoFailed} auto task${c.autoFailed === 1 ? '' : 's'} failed`,
        `${c.posts} word${c.posts === 1 ? '' : 's'} already posted by weevboss`,
      ].join(', '),
    digest: (o: { user: string; memory: string; done: string; waiting: string; counts: string; earlier: string }) =>
      `You are weevboss, the conductor of ${o.user}'s coding agents in weevils (the app from which they watch and drive their Claude Code and Codex sessions from their phone). ` +
      `You write them a word in their "for you" stream: where things stand since your last word, like a team lead leaning in at the door.\n\n` +
      `What came back (project, session, its last words):\n${o.done || '(nothing)'}\n\n` +
      `What is waiting for them (a question, a session cut off):\n${o.waiting || '(nothing)'}\n\n` +
      `In figures: ${o.counts}\n\n` +
      `What you know about them (goals, wishes):\n${o.memory || '(nothing yet)'}\n\n` +
      `Your last words (do not repeat yourself, in substance or in phrasing):\n${o.earlier || '(none)'}\n\n` +
      `Write:\n` +
      `- text: the recap, two to four sentences, spoken and casual, as you would say it to them (for example: ok, X is out, Y came back, Z is waiting on you). Quote the real project and session names above. Say what matters, not everything: what was delivered, what is stuck, what waits for them. No filler (no "great progress", "all going well", "feel free to"), no list, no heading, no emoji, no figure that is not above.\n` +
      `- thought: a single sentence that makes them think, only if you have something real to say from what is above, ideally tied to one of their goals (for example: actually, when you think about it…, or: honestly, I think something is off with…). Nothing real to say: no thought.\n` +
      `- actions: zero, one or two useful next steps they would start with one tap; label very short (4 words at most), brief = the full instruction you will receive if they tap (what to do, on which session or project). No obvious action: no actions.\n\n` +
      `Answer only in JSON: {"text": "…", "thought": "…", "actions": [{"label": "…", "brief": "…"}]} (thought and actions optional), in English.`,

    patProjects: (list: string) => `Sessions per project (last 14 days): ${list}`,
    patHours: (o: { morning: number; afternoon: number; evening: number; night: number }) => `When they finish their turns: morning ${o.morning}, afternoon ${o.afternoon}, evening ${o.evening}, night ${o.night}`,
    patCuts: (n: number, why: string) => `Sessions cut off mid-work: ${n}${why ? ` (${why})` : ''}`,
    patWaited: (n: number) => `Agent questions left more than 30 min without an answer: ${n}`,
    patAuto: (o: { done: number; failed: number; unanswered: number }) => `Auto tasks: ${o.done} done, ${o.failed} failed, ${o.unanswered} proposals left unanswered`,
    patUnused: (list: string) => `Parts of weevils not set up yet: ${list}`,
    patAdvice: (list: string) => `Advice from the machine page:\n${list}`,
    brick_voice: 'voice (listening to replies)',
    brick_dictation: 'dictation',
    brick_github: 'GitHub',
    improve: (o: { user: string; patterns: string; earlier: string }) =>
      `You look at how ${o.user} uses weevils (the app from which they watch and drive their Claude Code and Codex coding agents from their phone, with weevboss dispatching for them) and you suggest ONE concrete way for weevils to serve them better.\n\n` +
      `What was measured (nothing else is known):\n${o.patterns}\n\n` +
      `Already suggested (never suggest the same idea again, nor a close one):\n${o.earlier || '(nothing)'}\n\n` +
      `One idea only, drawn from a figure above and quoting it: a habit to take with weevboss, a setting, a part to set up, a routine to hand over. Nothing generic, nothing that needs a tool weevils does not have, nothing paid. If nothing really stands out from the figures, answer {}.\n\n` +
      `Answer only in JSON, in English: {"title": "5 words at most, no quotes", "text": "two sentences at most, speaking to them as you: what you saw, what you suggest", "action": {"label": "the button, 4 words at most", "brief": "the full instruction for weevboss if they accept: what to set up, where, how to check"}}`,

    factsDeps: (list: string) => `Declared dependencies: ${list}`,
    factsFiles: (list: string) => `Files at the root: ${list}`,
    factsCommits: (list: string) => `Latest commits:\n${list}`,
    factsLast: (title: string, text: string) => `What an agent just did there: ${title}${text ? `: ${text}` : ''}`,
    insight: (o: { repo: string; facts: string; earlier: string }) =>
      `Here is what is really in the repo "${o.repo}", where coding agents are working today for their user (who drives them from a phone and does not read all the code):\n\n${o.facts}\n\n` +
      `Already said (do not say it again):\n${o.earlier || '(nothing)'}\n\n` +
      `Write ONE "did you know" about a tool, a library or a technique really present above: something true and useful to know to direct the agents better, tied when possible to what they just did. ` +
      `Only well-established facts, that you would state without checking; no figure, date or version number you are not certain of; nothing about what you cannot see above. If nothing certain is worth saying, answer {}.\n\n` +
      `Answer only in JSON, in English: {"about": "the exact name of the tool, library or technique", "text": "one or two sentences, 220 characters at most, speaking to them as you, no quotes, no emoji"}`,
    more: (o: { repo: string; text: string; facts: string }) =>
      `In their stream, the user of weevils read this about their repo "${o.repo}" and wants to know more:\n"${o.text}"\n\n` +
      (o.facts ? `What is in the repo:\n${o.facts}\n\n` : '') +
      `Explain it to them in one paragraph (900 characters at most), speaking to them as you, simply: what it is, why it matters in this repo, and what they can ask their agents to make the most of it. ` +
      `Only well-established facts; no figure or date you are not certain of. Plain text: no heading, no list, no markdown, no emoji. In English.`,

    mailItem: (n: number, from: string, subject: string, text: string) => `### ${n}\nFrom: ${from}\nSubject: ${subject || '(no subject)'}\n${text}`,
    resultItem: (n: number, project: string, title: string, text: string) => `### ${n}\nFrom: the coding agent of project ${project} (its task: ${title || 'untitled'})\nIts end-of-turn report:\n${text}`,
    mailLines: (mails: string) =>
      `Here are messages received by the user of an app that drives coding agents (mails, agents' reports). For each one, write ONE very short line (90 characters at most) saying what the sender did, announces or asks, in the first person, as they would say it in passing to a human (for example: I finished the menu, the tests are left; I found why sessions were closing, it's fixed). ` +
      `No greeting, no quotes, no emoji, no file path, no command, no function name or needless jargon, nothing that is not in the message; in the language of the message.\n\n${mails}\n\n` +
      `Answer only in JSON, a list: [{"n": 1, "line": "…"}]`,

    msTurns: (n: number) => `${n} turns delivered today`,
    msProjects: (n: number) => `${n} projects moved forward today`,
    msAutoFirst: 'First auto task finished on its own',
    msStreak: (n: number) => `${n} days in a row with turns delivered`,

    statText: (n: number) => (n > 0 ? `Where the day stands: ${n} turn${n === 1 ? '' : 's'} delivered` : 'Where the day stands'),
    statUsage: (window: string) => `Claude · ${window}`,
    percent: (n: number) => `${n}%`,
    statTurns: (n: number, total: number) => `${n} of ${total}`,
    statAuto: 'Auto queue',
    statAutoShown: (running: number, queued: number) => `${running} running, ${queued} waiting`,
  },
})
