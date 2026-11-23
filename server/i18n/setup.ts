// Accueil et branchements (server/setup.ts) : ce que weevboss écrit lui-même dans son fil, composé à partir de l'état
// réel de la machine. Court, tutoiement en français, une idée par message. Les puces [[setup:x]] deviennent des boutons.
// Jamais de commande à taper : ce qui s'installe, weevilsd l'installe ; le reste, weevboss s'en charge.
import { defineMessages } from '../i18n.ts'
import type { MachineInfo, SetupState } from '../setup.ts'
import { secretBrand } from '../../shared/setup.ts'

const gb = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10)
/** Créer un jeton GitHub avec les bons droits, pré-rempli. */
const GH_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=weevils'

const kindFr = (m: MachineInfo) =>
  ({
    vps: m.provider ? `sur un VPS ${m.provider}` : 'sur un VPS',
    server: 'sur un serveur',
    container: 'dans un conteneur',
    vm: 'sur une machine virtuelle',
    laptop: m.mac ? 'sur ton Mac portable' : 'sur ton PC portable',
    desktop: m.mac ? 'sur ton Mac' : 'sur ton PC fixe',
    wsl: 'sur WSL, sous Windows',
  })[m.kind]
const kindEn = (m: MachineInfo) =>
  ({
    vps: m.provider ? `on a ${m.provider} VPS` : 'on a VPS',
    server: 'on a server',
    container: 'in a container',
    vm: 'on a virtual machine',
    laptop: m.mac ? 'on your MacBook' : 'on your laptop',
    desktop: m.mac ? 'on your Mac' : 'on your desktop PC',
    wsl: 'on WSL, on Windows',
  })[m.kind]
/** Sur un Mac, une seule voie pour être joint de partout (pas de domaine : install.sh y refuse --domain). */
const tailscaleMacFr = 'Tailscale (gratuit : une app sur ton Mac et sur ton téléphone, avec le même compte).'
const tailscaleMacEn = 'Tailscale (free: an app on your Mac and on your phone, with the same account).'
const local = (m: MachineInfo) => ['laptop', 'desktop', 'wsl'].includes(m.kind) && !m.othersAlwaysOn

export default defineMessages({
  fr: {
    hello: (name: string): string =>
      `Salut${name ? ` ${name}` : ''}, moi c’est weevboss. Je pilote tes agents Claude Code et Codex sur tes machines : tu me dis quoi faire, j’écris dans leurs sessions, je te résume. Par écrit ou à la voix, et même pendant que tu dors.`,
    // ---- téléphone
    phoneDesktop: 'D’abord, mets-moi dans ta poche : scanne ce code avec l’appareil photo du téléphone, tu es connecté direct. Puis ajoute-moi à l’écran d’accueil (iPhone : Partager puis « Sur l’écran d’accueil » ; Android : ⋮ puis « Installer l’application »).',
    phoneDesktopLocal: 'D’abord, mets-moi dans ta poche. Pour l’instant je n’écoute que sur cette machine : ton téléphone ne peut pas me joindre, il faut un chemin.',
    phoneIos: 'D’abord, installe-moi sur ton écran d’accueil : touche Partager (le carré avec la flèche) puis « Sur l’écran d’accueil ». Je m’ouvrirai en plein écran, comme une app, et je pourrai te prévenir quand un agent t’attend.',
    phoneAndroid: 'D’abord, installe-moi : menu ⋮ du navigateur, puis « Installer l’application ». Je m’ouvrirai en plein écran et je pourrai te prévenir quand un agent t’attend.',
    phoneInstalled: 'Tu m’as sur ton écran d’accueil, parfait. Active les notifications : je te préviens quand un agent t’attend ou a fini.',
    phoneAsk: (s: SetupState): string =>
      `Scanne ce code avec ton téléphone : il ouvre l’app déjà connectée. Ensuite, iPhone : Partager puis « Sur l’écran d’accueil » ; Android : ⋮ puis « Installer l’application ».${s.reach === 'local' ? ' Attention : cette adresse ne marche que sur cette machine, le téléphone ne la joindra pas sans chemin. [[setup:reach]]' : ''}`,
    pushAsk: (ios: boolean, standalone: boolean): string =>
      ios && !standalone
        ? 'Sur iPhone, les notifications ne marchent que depuis l’app ajoutée à l’écran d’accueil : ajoute-la (Partager puis « Sur l’écran d’accueil »), ouvre-la, et retape ici.'
        : 'Je te préviens quand un agent t’attend ou a fini, même app fermée. Un tap :',
    pushOk: 'Notifications activées sur cet appareil.',
    reachAsk: (s: SetupState): string =>
      s.reach === 'public'
        ? s.https
          ? `Je suis joignable de partout, en https : ${s.url}. Rien à faire de ce côté.`
          : `Je suis joignable de partout (${s.url}), mais en http : le code d’accès circule en clair et le micro du téléphone refuse de marcher. ${s.machine.mac ? `Pour passer en https, le plus simple : ${tailscaleMacFr}` : 'Pour passer en https, il me faut un nom de domaine qui pointe sur cette machine.'}`
        : `${s.reach === 'lan' ? `Je ne suis joignable que sur ton réseau local (${s.url})` : `Je n’écoute que sur ${s.machine.mac ? 'ce Mac' : s.machine.host}`} : ton téléphone ne peut pas me joindre de dehors. ${s.machine.mac ? `Le plus simple : ${tailscaleMacFr}` : 'Deux chemins : un nom de domaine qui pointe sur la machine (https automatique), ou Tailscale (gratuit : une app sur ton téléphone, rien à acheter).'}`,
    reachPrompt: (http: boolean): string => (http ? 'Donne-moi ton domaine en bas, je m’occupe du reste.' : 'Tape ton domaine en bas, ou laisse vide et je pars sur Tailscale. Je m’occupe du reste.'),
    reachDns: (domain: string, ip: string, seen: string): string =>
      `« ${domain} » ne pointe pas encore sur cette machine (${seen ? `il pointe sur ${seen}` : 'il ne pointe nulle part'}). Chez ton fournisseur de domaine, ajoute un enregistrement A « ${domain} » vers ${ip}, attends quelques minutes, puis réessaie :`,
    reachDomainDo: (domain: string): string => `Passe-moi en https sur ${domain}.`,
    reachTailscaleDo: 'Rends-moi joignable de partout avec Tailscale.',
    // Sur un Mac : pas de champ, weevboss s'y met dès le tap.
    reachMacGo: 'Je m’y mets, et je te dis ce qu’il y a à faire de ton côté.',
    reachMacDomain: (domain: string): string => `Sur un Mac, je ne sais pas me brancher sur un nom de domaine (« ${domain} »). Le chemin qui marche ici, c’est Tailscale :`,
    // ---- machine
    machine: (m: MachineInfo): string => {
      const spec = `${m.os}, ${m.cpus} cœur${m.cpus > 1 ? 's' : ''}, ${gb(m.ramGb)} Go`
      const room = m.agents > 1 ? ` : de quoi faire tourner ${m.agents} agents à la fois` : ''
      if (m.kind === 'wsl')
        return `Tu tournes sur WSL (${spec}). Ça marche, mais WSL s’arrête quand Windows se met en veille, et ton téléphone ne le joint pas tel quel. Pour que tes agents bossent la nuit, prends un petit VPS : je t’aide à le brancher. [[setup:machine]]`
      if ((m.kind === 'laptop' || m.kind === 'desktop') && !m.othersAlwaysOn)
        return `Tu tournes ${kindFr(m)} (${spec})${room}. Ça marche, mais tes agents s’arrêtent quand ${m.kind === 'laptop' ? 'il se met en veille' : 'il s’éteint'}. Pour qu’ils bossent la nuit, prends un petit VPS (2 vCPU et 4 Go suffisent, quelques euros par mois) : je t’aide à le brancher. [[setup:machine]]`
      if (m.kind === 'laptop' || m.kind === 'desktop') return `Tu tournes ${kindFr(m)} (${spec})${room}, et ${m.others.join(', ')} reste allumé pour la nuit : bon combo.`
      const always = m.kind === 'container' ? 'tant que le conteneur tourne, tes agents bossent' : 'il reste allumé : tes agents bossent même quand ton téléphone dort'
      const small = m.agents <= 1 ? ` Avec ${gb(m.ramGb)} Go, un agent à la fois ; pour en faire tourner plusieurs, le palier au-dessus (4 Go et plus).` : ''
      const second = m.others.length ? ` ${m.others.join(', ')} est branché en seconde machine.` : ''
      return `Tu tournes ${kindFr(m)} (${spec})${room} ; ${always}.${small}${second}`
    },
    machineAsk: (s: SetupState): string =>
      local(s.machine)
        ? 'Le plus simple : un petit VPS sous Ubuntu (2 vCPU, 4 Go, quelques euros par mois), allumé jour et nuit. Choisis ton hébergeur en bas, ou « j’en ai pas » et je t’aide à en choisir un. Ensuite son adresse et le mot de passe qu’il t’a envoyé : je m’occupe du reste.'
        : 'Pour brancher une autre machine (un VPS, un serveur) : choisis l’hébergeur en bas, puis son adresse et le mot de passe qu’il t’a envoyé. Je m’occupe du reste.',
    machineNone:
      'Pour weevils, 2 vCPU et 4 Go de mémoire sous Ubuntu 24.04 suffisent, pour quelques euros par mois. Trois bons choix :\n\n- [Hetzner](https://www.hetzner.com/cloud) : le moins cher, en Europe.\n- [OVHcloud](https://www.ovhcloud.com/fr/vps/) : en France, support en français.\n- [Hostinger](https://www.hostinger.com/fr/vps) : le plus simple à prendre en main.\n\nPrends Ubuntu 24.04 et garde l’adresse IP et le mot de passe qu’ils t’envoient. Quand c’est fait, touche le bouton :',
    machineTrying: (target: string): string => `Je me connecte à ${target}…`,
    machineBadHost: (host: string): string => `Je ne reconnais pas cette adresse (${host}). Il me faut l’adresse IP du VPS (quatre nombres, comme 203.0.113.7) ou son nom. Réessaie :`,
    machineRefused: (target: string, why: string, provider: string, key: string): string =>
      `Je n’arrive pas à entrer sur ${target} (${why}). Réessaie avec le mot de passe que ${provider} t’a envoyé, ou ajoute cette clé dans son panneau (rubrique « Clés SSH »), puis retouche le bouton :\n\`${key}\``,
    machineIn: (target: string, about: string): string =>
      `Je suis entré sur ${target}${about ? ` (${about})` : ''}. J’y ai posé ma clé : le mot de passe n’est gardé nulle part.`,
    sshWhy: (raw: string): string =>
      /permission denied/i.test(raw) ? 'mot de passe ou clé refusés' : /timed out|no route|unreachable/i.test(raw) ? 'la machine ne répond pas' : /could not resolve|name or service/i.test(raw) ? 'adresse introuvable' : /connection refused/i.test(raw) ? 'SSH fermé sur cette machine' : /host key/i.test(raw) ? 'la machine a changé d’identité depuis la dernière fois' : raw.replace(/^[^\s:]*@[^\s:]*:\s*/, '') || 'pas de réponse',
    machineNoSsh: 'Il me manque SSH sur cette machine pour joindre la nouvelle.',
    machineDo: (target: string, provider: string): string => `Branche ${target}${provider ? ` (${provider})` : ''} sur weevils.`,
    machineLater: 'Connecte Claude Code et je finis le branchement tout seul :',
    // ---- Claude Code
    claudeInstalling: (host: string): string => `J’installe Claude Code sur ${host}, une minute…`,
    // La connexion se fait en parlant : le lien ici, le code collé dans le fil. Un terminal seulement si rien ne marche d'ici.
    claudeLink: (url: string): string => `Ouvre [la page de connexion de Claude](${url}), accepte, puis colle ici le code qu’elle affiche.`,
    claudeTerminal: (why: string, line: string): string => `Je n’arrive pas à lancer la connexion de Claude d’ici (${why}). Dans un terminal sur cette machine, tape \`${line}\` et connecte-toi : je le verrai tout seul.`,
    claudeFail: (why: string): string => `Claude n’accepte pas ce code (${/wasn.t accepted|invalid|expired/i.test(why) ? 'incomplet, expiré ou déjà utilisé' : why}). Voici un nouveau lien :`,
    // ---- Accueil (premier lancement, Setup.welcome) : bonjour, ce que weevils voit déjà, puis la seule chose qui manque.
    welcomeHello: (name: string): string => `Salut${name ? ` ${name}` : ''}, moi c’est weevboss ! 👋 weevils réunit **tous tes agents IA et toutes tes machines** au même endroit, dans ta poche : Claude Code, Codex, ton ordi, tes serveurs. Tu donnes le cap, je fais tourner toute l’équipe 🚀 Ton propre abonnement IA, ton code reste chez toi, et weevils est gratuit.`,
    welcomeSeen: (count: number, names: string[], machines: string[]): string => {
      const shown = names.slice(0, 4)
      const and = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l.at(-1)}` : l[0] ?? '')
      const list = shown.length ? ` (${shown.length < count ? `${shown.join(', ')}…` : and(shown)})` : ''
      const p = count ? `Je vois déjà ${count > 1 ? `tes ${count} projets` : 'ton projet'}${list}` : ''
      const m = machines.length ? `${machines.length > 1 ? `tes machines ${and(machines)} sont branchées` : `ta machine ${machines[0]} est branchée`} aussi` : ''
      return p && m ? `${p}, et ${m}.` : p ? `${p}.` : m ? `${m[0].toUpperCase()}${m.slice(1)}.` : ''
    },
    welcomeReady: (name: string): string => `${name} est déjà connecté, alors on commence : dis-moi ce que tu veux faire, un jeu, un site, un petit outil, une question sur ton code…`,
    welcomeClaude: (chatgpt: boolean): string =>
      chatgpt ? 'Pour commencer, mes agents ont besoin d’un abonnement IA, Claude ou ChatGPT, au choix. Claude ?' : 'Pour commencer, mes agents ont besoin d’un abonnement Claude. Tu en as un ?',
    welcomeChatgpt: 'ChatGPT ? [Connecte-le](/#do=codex).',
    welcomeNoClaude: 'Pas encore d’abonnement ? [Choisis une offre Claude](https://claude.com/pricing), puis reviens ici.',
    welcomeClaudeLink: 'Pour commencer, connecte ton compte Claude, une seule fois : le lien arrive juste en dessous.',
    welcomeClaudeInstall: (host: string): string => `Pour commencer, j’installe Claude Code sur ${host}, puis tu connectes ton compte Claude : le lien suit dans une minute.`,
    welcomeCodex: 'Pour commencer, connecte ton compte ChatGPT, par Codex : le code arrive juste en dessous.',
    welcomeGuest: 'Une question en attendant ? Pose-la-moi.',
    claudeReadyJob: 'Claude est connecté : je lance ce que tu m’as demandé.',
    claudeReady: 'Claude Code est connecté : je suis prêt. Dis-moi ce que tu veux faire, par exemple « crée un repo pour mon idée de… » ou « où en est mon projet ? ».',
    claudeOk: 'Claude Code est connecté sur cette machine.',
    notLoggedShort: 'Pour tout le reste, il me faut Claude Code connecté sur cette machine.',
    // ---- Codex
    providerUnavailable: (name: string) => `La connexion à ${name} n’est pas disponible sur cette machine.`,
    providerLater: (name: string) => `Pour le reste, il me faut d’abord ${name} connecté.`,
    codexPrimaryReady: 'Codex est connecté : je suis prêt. Dis-moi ce que tu veux faire.',
    codexReady: 'Codex est prêt : dis « avec codex » et j’ouvre la session dedans.',
    codexInstalling: (host: string): string => `J’installe Codex sur ${host}…`,
    codexTerminal: (why: string, line: string): string => `Je n’arrive pas à connecter Codex d’ici (${why}). Dans un terminal sur cette machine, tape \`${line}\` : je le verrai tout seul.`,
    codexCode: (url: string, code: string): string =>
      `Pour connecter Codex à ton compte ChatGPT : ouvre [cette page](${url}), connecte-toi et tape le code ${code} (valable 15 minutes). Je te fais signe dès que c’est bon.`,
    codexFail: (why: string): string => `La connexion de Codex n’a pas abouti (${why}). Dis-moi quand tu veux réessayer.`,
    // ---- Un autre ordinateur, d'une ligne (server/join.ts) ; le connecteur ; un travail confié à une session.
    joinLine: (line: string): string =>
      `Sur ton autre ordinateur, ouvre un terminal et colle cette ligne :\n\n\`${line}\`\n\nElle marche une fois, pendant une heure. Je te dis ici quand il est branché.`,
    joinKey: (id: string): string => `${id} se branche : weevils s’installe dessus, quelques minutes.`,
    joinOnline: (name: string): string => `[[win]]**${name} est branché** : je peux y lancer des agents.`,
    linkDown: (name: string): string => `${name} ne répond plus depuis 10 minutes. S’il est allumé, lance \`weevils-service restart\` dessus.`,
    linkBack: (name: string): string => `${name} est de nouveau connecté.`,
    joinFailed: (id: string, why: string, fix: string): string =>
      `${id} n’a pas pu s’installer : ${why}${fix ? `\n\nSur ${id}, lance \`${fix}\`, puis demande-moi une nouvelle ligne.` : '\n\nDemande-moi une nouvelle ligne pour réessayer.'}`,
    connectorNeedsHttps: (url: string): string =>
      `ChatGPT et Claude.ai ne me joignent qu’à une adresse publique en https, et pour l’instant je suis à ${url}. Demande-moi de me rendre joignable de partout : on le branche juste après.`,
    connectorHow: (url: string, tunnel: boolean): string =>
      `Ajoute cette adresse dans ton app de chat : \`${url}\`\n\n- Claude.ai : Paramètres → Connecteurs → Ajouter un connecteur personnalisé, colle-la, puis Connecter.\n- ChatGPT : Paramètres → Applications et connecteurs → Paramètres avancés, active le mode développeur, puis Créer, colle-la.\n\nElle te demande une fois ton code d’accès weevils.${tunnel ? ' Cette adresse change quand la machine redémarre : pour qu’elle tienne, il faudra un nom de domaine.' : ''}`,
    delegated: 'Je l’ai confié à un agent : il te demande ton accord dans l’app avant chaque étape.',
    // ---- GitHub
    githubPitch: 'Branche GitHub : je verrai tous tes repos (glisse le fil vers la gauche), j’en créerai pour tes nouvelles idées et je rangerai les sessions par projet.',
    githubAsk: (s: SetupState): string =>
      s.github.logged
        ? `GitHub est branché${s.github.login ? ` (${s.github.login})` : ''}. Glisse le fil vers la gauche pour voir tes repos ; le + en met un dans le fil.`
        : `Avec GitHub branché, je vois tous tes repos, j’en crée pour tes idées et je range les sessions par projet. Crée un jeton sur [cette page GitHub](${GH_TOKEN_URL}) (« Generate token » en bas), copie-le et colle-le en bas.`,
    githubOk: (login: string): string => `GitHub branché : ${login}. Je peux créer des repos pour tes idées.`,
    githubFail: (why: string): string => `GitHub refuse ce jeton (${why}). Vérifie qu’il a les droits repo et read:org, puis réessaie :`,
    githubNoCli: (why: string): string => `J’ai gardé le jeton, mais l’outil GitHub ne s’installe pas sur la machine (${why}) : demande-moi de réessayer.`,
    // ---- GitHub en parlant (le coffre, docs/spec/07-vault.md) : le code de GitHub, tapé sur github.com.
    githubDevice: (url: string, code: string): string => `Connecte ton GitHub, une seule fois : ouvre [github.com/login/device](${url}) et tape ce code : **${code}** (valable 15 minutes). Je continue dès que c’est fait.`,
    githubDeviceFail: (why: string): string => `La connexion à GitHub n’a pas abouti (${why}). Dis-moi quand tu veux réessayer.`,
    githubDeviceDone: 'GitHub est connecté.',
    syncStart: 'Tu es connecté à GitHub et à Claude. Je synchronise tes conversations pour que tu puisses les reprendre depuis n’importe quelle machine ou abonnement.',
    syncDone: (n: number): string => `[[win]]**C’est fait** : ${n > 1 ? `tes ${n} conversations sont` : n === 1 ? 'ta conversation est' : 'tes conversations sont'} à toi maintenant, en sécurité sur ton GitHub. 🎉 Garde ton [code de secours](/#do=recovery) en lieu sûr : avec lui, une nouvelle machine récupère tout.`,
    vpsOffer: 'Pour que weevils travaille 24 h/24, même ordinateur éteint, je te conseille un serveur (environ 5 €/mois). Je peux [le mettre en place maintenant](/#do=server), ou [te le rappeler plus tard](/#do=later).',
    vpsLater: 'D’accord, je t’en reparlerai quand ce sera utile.',
    recoveryCode: (words: string): string => `Ton code de secours, à garder comme un mot de passe (avec lui, une nouvelle machine récupère toutes tes conversations) :\n\n\`${words}\``,
    recoveryShown: 'Ton code de secours a déjà été montré, plus haut : je ne le réécris pas.',
    welcomeGithub: '[Connecte ton GitHub](/#do=github) et je garde toutes tes conversations là-bas, à toi.',
    // ---- voix
    voiceAsk: (s: SetupState): string => {
      const spoken =
        s.voice.spoken === 'cartesia'
          ? 'Ma voix passe par Cartesia, la plus naturelle.'
          : s.voice.spoken === 'edge'
            ? 'Je te réponds déjà à voix haute (voix gratuite). Pour une voix plus naturelle, colle une clé Cartesia en bas ([play.cartesia.ai/keys](https://play.cartesia.ai/keys), offre gratuite pour commencer).'
            : 'Je n’ai pas encore de voix : j’installe la voix gratuite. Pour une voix plus naturelle, colle une clé Cartesia en bas ([play.cartesia.ai/keys](https://play.cartesia.ai/keys)).'
      const dict = s.voice.openai
        ? s.voice.https
          ? ' La dictée est branchée : tape le logo pour me parler.'
          : ' La dictée est branchée, mais le micro du téléphone exige une adresse en https. [[setup:reach]]'
        : ' Pour me dicter tes messages, il me faut une clé OpenAI (quelques centimes par jour, [platform.openai.com/api-keys](https://platform.openai.com/api-keys)).'
      return `${spoken}${dict}`
    },
    voiceFreeOk: 'La voix gratuite est installée : je te réponds à voix haute.',
    voiceFreeFail: (why: string): string => `La voix gratuite ne s’installe pas (${why}). Une clé Cartesia marche sans rien installer :`,
    voiceOk: (what: string[]): string => `Enregistré et vérifié : ${what.join(', ')}. Tape le logo pour me parler : un tap pour parler, un pour arrêter, un pour envoyer.`,
    voiceFail: (who: string, why: string): string => `${who} refuse cette clé (${why}). Réessaie :`,
    voiceNothing: 'Rien de changé.',
    // ---- devil
    devilAsk: (plugged: boolean, model: string): string =>
      plugged
        ? `Le diable est branché sur ${model}. Tape-le pour basculer (la bande passe en orange, ses réponses arrivent en vert), encore pour revenir. Pour changer de modèle :`
        : 'Le diable envoie tes messages à un autre modèle, sans filtre, dans ce même fil : par exemple un modèle « abliterated » que tu fais tourner chez toi (Ollama, LM Studio, vLLM) ou que tu loues (OpenRouter, RunPod…), du moment qu’il parle l’API OpenAI. Il me faut son adresse, son nom et sa clé : je te les demande une par une, ils restent sur ta machine.',
    devilOk: (model: string, ms: number): string => `Branché : ${model} répond (${ms} ms). Tape le diable pour basculer : la bande passe en orange, ses réponses arrivent en vert, dans ce même fil.`,
    devilNoModel: (model: string, list: string): string => `Le serveur répond, mais je ne trouve pas « ${model} » chez lui. Il propose : ${list}. Réessaie avec l’un d’eux :`,
    devilFail: (why: string): string => `Je n’arrive pas à joindre le modèle (${why}). Vérifie l’adresse (elle finit souvent par /v1) et que sa machine est allumée, puis réessaie :`,
    // ---- e-mail
    mailPitch: 'Tu veux me parler depuis ChatGPT, un autre agent ou n’importe quel outil qui envoie des mails ? Branche le pont e-mail : chaque expéditeur que tu autorises m’écrit, signé à son nom et dans sa couleur, et je lui réponds dans le même fil.',
    mailAsk: 'Il faut une boîte Gmail avec la validation en deux étapes (myaccount.google.com/signinoptions/twosv). Crée un mot de passe d’application nommé « weevils » sur myaccount.google.com/apppasswords et garde-le sous la main : je te demande ton adresse Gmail, puis ce mot de passe. Je m’occupe de l’alias +weevils, sans filtre à créer.',
    mailOk: (alias: string): string =>
      `Pont branché : ${alias}. Rien à régler dans Gmail : les mails envoyés à cette adresse m’arrivent directement, et je ne lis jamais le reste de ta boîte. Dis-moi maintenant qui a le droit de m’écrire :`,
    mailFail: (why: string): string => `Gmail refuse la connexion (${why}). Vérifie l’adresse et le mot de passe d’application (16 lettres), puis réessaie :`,
    authorAsk: 'Qui a le droit de m’écrire ? Donne-moi son nom (affiché sur ses messages), l’adresse d’où il écrit, et une couleur si tu veux (sinon j’en choisis une).',
    authorOk: (name: string, email: string, alias: string): string =>
      alias ? `${name} peut m’écrire depuis ${email} à ${alias} : ses messages arrivent signés à son nom. Un autre ?` : `${name} pourra m’écrire depuis ${email} dès que le pont e-mail sera branché :`,
    authorBad: 'Il me faut un nom et une adresse e-mail valide. Réessaie :',
    authorShared: (id: string): string =>
      `C’est ton propre compte : il se nomme dans chaque mail, « [${id}] » dans l’objet ou « — ${id} » en signature, et ses messages arrivent à son nom. Sans nom, c’est toi qui m’écris.`,
    authorPending: (names: string[]): string =>
      `${names.join(' et ')} ${names.length > 1 ? 'sont déclarés' : 'est déclaré'} sans adresse e-mail : ${names.length > 1 ? 'ils ne peuvent' : 'il ne peut'} pas encore m’écrire. Donne-moi d’abord ${names.length > 1 ? 'leurs adresses' : 'son adresse'} (même nom, la couleur reste).`,
    // ---- quota
    quotaAsk: (lines: string[]): string =>
      lines.length
        ? `Ton abonnement : ${lines.join(' · ')}. Quand un quota approche de sa limite, je passe le travail à l’autre agent si tu en as deux. [[setup:codex]]`
        : 'Je ne lis pas encore ton quota : il apparaît dès que Claude Code (ou Codex) est connecté et a servi une fois.',
    quotaLine: (tool: string, plan: string, parts: string): string => `${tool}${plan ? ` ${plan}` : ''} ${parts}`,
    quotaWindow: (kind: string, pct: number): string => `${kind === 'session' ? 'session' : kind === 'week' ? 'semaine' : kind} ${pct} %`,
    // ---- sécurité
    securityAsk: (s: SetupState): string =>
      [
        'Ton code d’accès est une clé complète de cette machine : quiconque l’a peut piloter tes agents. Ne l’envoie à personne.',
        s.security.exposedHttp ? 'Attention : je suis joignable en http, le code circule en clair. Passe en https : [[setup:reach]]' : s.security.https ? 'L’adresse est en https : bien.' : 'Je n’écoute que sur cette machine : rien n’est exposé.',
        s.security.safe ? 'Tes agents demandent la permission avant d’agir.' : 'Tes agents tournent sans demander de permission : rapide, mais c’est une raison de plus de garder le code pour toi.',
        'Pour changer de code et déconnecter tous les appareils, demande-le-moi.',
      ].join(' '),
    // ---- conversations d’un autre ordinateur
    historyAsk:
      'Tes conversations Claude Code et Codex restent sur l’ordinateur où elles ont tourné. Sur cet ordinateur, colle la ligne ci-dessous dans un terminal : elles s’affichent ici, tu touches celles à ramener, et elles continuent ici avec tout ce qu’elles savaient. [[setup:history]]',
    // ---- Siri
    shortcutAsk:
      'Sur iPhone, un Raccourci te laisse me parler sans ouvrir l’app : « Dis Siri, weevboss », ou le bouton Action. Touche le bouton : je copie ton adresse personnelle, puis dans l’app Raccourcis, + et ces actions :\n\n1. « Dicter le texte »\n2. « Obtenir le contenu de l’URL » : colle l’adresse, Méthode POST, Corps de la requête JSON, champ text = Texte dicté\n3. « Obtenir la valeur du dictionnaire » : clé say\n4. « Énoncer le texte »\n\nNomme-le « weevboss » : Siri le trouve tout seul.',
    shortcutOk: 'Adresse copiée : colle-la dans l’action « Obtenir le contenu de l’URL ».',
    // ---- installer
    installHave: (os: string, have: string[]): string => `Sur ${os}, déjà là : ${have.join(', ')}.`,
    installMissing: (missing: string[]): string => `Il manque ${missing.join(', ')} : un tap sur chacun, je l’installe et je le connecte.`,
    installAll: 'Tout l’essentiel est là.',
    // Pour weevboss seul (« weevils setup install ») : jamais montré à l'utilisateur.
    installIntro: (os: string, missing: boolean): string =>
      missing ? `Sur ${os}, voici ce qui manque, dans l’ordre. Lance ces commandes toi-même, ne les donne jamais à l’utilisateur :` : `Sur ${os}, tout l’essentiel est déjà là.`,
    installDone: 'Déjà installé :',
    installLogins: 'Puis les connexions : propose la puce [[setup:claude]], [[setup:github]] ou [[setup:codex]], jamais une commande.',
    keySaved: (name: string) => {
      const { brand, token } = secretBrand(name)
      return token
        ? `Jeton ${brand} enregistré sur cette machine (jamais affiché). L’agent qui l’a demandé peut s’en servir.`
        : `Clé ${brand} enregistrée sur cette machine (jamais affichée). L’agent qui l’a demandée peut s’en servir.`
    },
    /** Ce que l'utilisateur a « dit » dans le fil en collant le secret : la marque, jamais le nom de variable. */
    keyTyped: (name: string) => {
      const { brand, token } = secretBrand(name)
      return `${token ? `mon jeton ${brand}` : `ma clé ${brand}`} : ••••`
    },
    badSecret: 'clé ou valeur refusée',
    installNoSudo: 'Pas de sudo ici : ces commandes s’installent dans le dossier de l’utilisateur.',
    installNoBrew: (clone: string): string =>
      `Homebrew manque sur ce Mac, et c’est lui qui installe les outils de base et Node.js. Lance toi-même \`${clone}/install.sh --agent\` (étape 4 de ${clone}/AGENTS.md) : il installe Homebrew, ou dit dans son résumé ce que l’utilisateur doit faire s’il faut le mot de passe du Mac.`,
    needClaude: 'Connecte d’abord Claude Code : c’est moi qui m’en occuperai ensuite.',
    needSudo: 'Pour ça il me faut les droits administrateur sur cette machine, et je ne les ai pas ici. Demande-les à la personne qui la gère, ou branche un VPS à toi :',
    working: 'Je m’en occupe.',
    // ---- divers
    saved: 'enregistré',
    masked: (tail: string): string => `••••${tail}`,
    detected: 'Je l’ai vu : c’est branché.',
    badBrick: 'branchement inconnu',
    localOnly: 'seulement depuis la machine',
    badKey: 'réglage non modifiable ici',
    noQr: 'qrencode n’est pas installé',
    badValue: (field: string): string => `réponse manquante : ${field}`,
    badProject: (name: string): string => `pas un nom de projet : « ${name} » (minuscules, chiffres et tirets)`,
    // ---- nom des champs, dans la bulle récapitulative
    field_url: 'adresse',
    field_model: 'modèle',
    field_key: 'clé',
    field_cartesia: 'clé Cartesia',
    field_openai: 'clé OpenAI',
    field_token: 'jeton',
    field_gmail: 'Gmail',
    field_password: 'mot de passe',
    field_name: 'nom',
    field_email: 'e-mail',
    field_color: 'couleur',
    field_code: 'code',
    field_provider: 'hébergeur',
    field_host: 'adresse',
    field_user: 'utilisateur',
    field_domain: 'domaine',
    voiceName: 'la voix',
    gb: (n: number): string => `${n} Go`,
    prov_none: 'j’en ai pas',
    prov_other: 'autre',
    otherHost: 'ton hébergeur',
    noAnswer: 'pas de réponse',
  },
  en: {
    hello: (name: string): string =>
      `Hi${name ? ` ${name}` : ''}, I’m weevboss. I run your Claude Code and Codex agents on your machines: you tell me what to do, I write in their sessions and sum it up for you. Typed or spoken, even while you sleep.`,
    phoneDesktop: 'First, put me in your pocket: scan this code with your phone’s camera, you’re signed in right away. Then add me to the home screen (iPhone: Share then “Add to Home Screen”; Android: ⋮ then “Install app”).',
    phoneDesktopLocal: 'First, put me in your pocket. Right now I only listen on this machine: your phone can’t reach me, it needs a way in.',
    phoneIos: 'First, add me to your home screen: tap Share (the square with the arrow) then “Add to Home Screen”. I’ll open full screen, like an app, and I can tell you when an agent needs you.',
    phoneAndroid: 'First, install me: the browser’s ⋮ menu, then “Install app”. I’ll open full screen and I can tell you when an agent needs you.',
    phoneInstalled: 'You have me on your home screen, great. Turn on notifications: I’ll tell you when an agent needs you or is done.',
    phoneAsk: (s: SetupState): string =>
      `Scan this code with your phone: it opens the app already signed in. Then, iPhone: Share then “Add to Home Screen”; Android: ⋮ then “Install app”.${s.reach === 'local' ? ' Careful: this address only works on this machine, the phone won’t reach it without a way in. [[setup:reach]]' : ''}`,
    pushAsk: (ios: boolean, standalone: boolean): string =>
      ios && !standalone
        ? 'On iPhone, notifications only work from the app added to the home screen: add it (Share then “Add to Home Screen”), open it, and tap here again.'
        : 'I’ll tell you when an agent needs you or is done, even with the app closed. One tap:',
    pushOk: 'Notifications are on for this device.',
    reachAsk: (s: SetupState): string =>
      s.reach === 'public'
        ? s.https
          ? `I’m reachable from anywhere, over https: ${s.url}. Nothing to do here.`
          : `I’m reachable from anywhere (${s.url}), but over http: the access code travels in clear text and the phone’s microphone won’t work. ${s.machine.mac ? `To switch to https, the simple way: ${tailscaleMacEn}` : 'To switch to https I need a domain name pointing at this machine.'}`
        : `${s.reach === 'lan' ? `I’m only reachable on your local network (${s.url})` : `I only listen on ${s.machine.mac ? 'this Mac' : s.machine.host}`}: your phone can’t reach me from outside. ${s.machine.mac ? `The simple way: ${tailscaleMacEn}` : 'Two ways: a domain name pointing at the machine (automatic https), or Tailscale (free: an app on your phone, nothing to buy).'}`,
    reachPrompt: (http: boolean): string => (http ? 'Give me your domain below, I’ll take care of the rest.' : 'Type your domain below, or leave it empty and I’ll go with Tailscale. I’ll take care of the rest.'),
    reachDns: (domain: string, ip: string, seen: string): string =>
      `“${domain}” doesn’t point at this machine yet (${seen ? `it points at ${seen}` : 'it points nowhere'}). At your domain provider, add an A record “${domain}” to ${ip}, wait a few minutes, then try again:`,
    reachDomainDo: (domain: string): string => `Switch me to https on ${domain}.`,
    reachTailscaleDo: 'Make me reachable from anywhere with Tailscale.',
    reachMacGo: 'I’m on it, and I’ll tell you what there is to do on your side.',
    reachMacDomain: (domain: string): string => `On a Mac I can’t set myself up on a domain name (“${domain}”). The way that works here is Tailscale:`,
    machine: (m: MachineInfo): string => {
      const spec = `${m.os}, ${m.cpus} core${m.cpus > 1 ? 's' : ''}, ${gb(m.ramGb)} GB`
      const room = m.agents > 1 ? `: room for ${m.agents} agents at once` : ''
      if (m.kind === 'wsl')
        return `You’re running on WSL (${spec}). It works, but WSL stops when Windows sleeps, and your phone can’t reach it as is. For your agents to work overnight, get a small VPS: I’ll help you plug it in. [[setup:machine]]`
      if ((m.kind === 'laptop' || m.kind === 'desktop') && !m.othersAlwaysOn)
        return `You’re running ${kindEn(m)} (${spec})${room}. It works, but your agents stop when it ${m.kind === 'laptop' ? 'goes to sleep' : 'shuts down'}. For them to work overnight, get a small VPS (2 vCPU and 4 GB are enough, a few dollars a month): I’ll help you plug it in. [[setup:machine]]`
      if (m.kind === 'laptop' || m.kind === 'desktop') return `You’re running ${kindEn(m)} (${spec})${room}, and ${m.others.join(', ')} stays on overnight: good combo.`
      const always = m.kind === 'container' ? 'as long as the container runs, your agents keep working' : 'it stays on: your agents keep working while your phone sleeps'
      const small = m.agents <= 1 ? ` With ${gb(m.ramGb)} GB, one agent at a time; to run several, the next tier up (4 GB or more).` : ''
      const second = m.others.length ? ` ${m.others.join(', ')} is plugged in as a second machine.` : ''
      return `You’re running ${kindEn(m)} (${spec})${room}; ${always}.${small}${second}`
    },
    machineAsk: (s: SetupState): string =>
      local(s.machine)
        ? 'Simplest: a small Ubuntu VPS (2 vCPU, 4 GB, a few dollars a month), on day and night. Pick your host below, or “I don’t have one” and I’ll help you choose. Then its address and the password it sent you: I’ll take care of the rest.'
        : 'To plug in another machine (a VPS, a server): pick the host below, then its address and the password it sent you. I’ll take care of the rest.',
    machineNone:
      'For weevils, 2 vCPU and 4 GB of memory on Ubuntu 24.04 are enough, for a few dollars a month. Three good picks:\n\n- [Hetzner](https://www.hetzner.com/cloud): the cheapest, in Europe.\n- [DigitalOcean](https://www.digitalocean.com/products/droplets): data centers worldwide.\n- [Hostinger](https://www.hostinger.com/vps-hosting): the easiest to get started with.\n\nPick Ubuntu 24.04 and keep the IP address and password they send you. Once it’s done, tap the button:',
    machineTrying: (target: string): string => `Connecting to ${target}…`,
    machineBadHost: (host: string): string => `I don’t recognize this address (${host}). I need the VPS’s IP address (four numbers, like 203.0.113.7) or its name. Try again:`,
    machineRefused: (target: string, why: string, provider: string, key: string): string =>
      `I can’t get into ${target} (${why}). Try again with the password ${provider} sent you, or add this key in its panel (the “SSH keys” section), then tap the button again:\n\`${key}\``,
    machineIn: (target: string, about: string): string => `I’m in ${target}${about ? ` (${about})` : ''}. I left my key there: the password isn’t kept anywhere.`,
    sshWhy: (raw: string): string =>
      /permission denied/i.test(raw) ? 'password or key refused' : /timed out|no route|unreachable/i.test(raw) ? 'the machine doesn’t answer' : /could not resolve|name or service/i.test(raw) ? 'address not found' : /connection refused/i.test(raw) ? 'SSH is closed on that machine' : /host key/i.test(raw) ? 'the machine changed identity since last time' : raw.replace(/^[^\s:]*@[^\s:]*:\s*/, '') || 'no answer',
    machineNoSsh: 'This machine has no SSH to reach the new one.',
    machineDo: (target: string, provider: string): string => `Plug ${target}${provider ? ` (${provider})` : ''} into weevils.`,
    machineLater: 'Sign Claude Code in and I’ll finish plugging it in on my own:',
    claudeInstalling: (host: string): string => `Installing Claude Code on ${host}, one minute…`,
    claudeLink: (url: string): string => `Open [Claude’s sign-in page](${url}), accept, then paste the code it shows here.`,
    claudeTerminal: (why: string, line: string): string => `I can’t start Claude’s sign-in from here (${why}). In a terminal on this machine, type \`${line}\` and sign in: I’ll notice on my own.`,
    claudeFail: (why: string): string => `Claude doesn’t accept this code (${/wasn.t accepted|invalid|expired/i.test(why) ? 'incomplete, expired or already used' : why}). Here’s a new link:`,
    welcomeHello: (name: string): string => `Hi${name ? ` ${name}` : ''}, I’m weevboss! 👋 weevils brings **all your AI agents and all your machines** together in one place, right in your pocket: Claude Code, Codex, your computer, your servers. You call the shots, I keep the whole crew moving 🚀 Your own AI subscription, your code stays home, and weevils is free.`,
    welcomeSeen: (count: number, names: string[], machines: string[]): string => {
      const shown = names.slice(0, 4)
      const and = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] ?? '')
      const list = shown.length ? ` (${shown.length < count ? `${shown.join(', ')}…` : and(shown)})` : ''
      const p = count ? `I can already see ${count > 1 ? `your ${count} projects` : 'your project'}${list}` : ''
      const m = machines.length ? `${and(machines)} ${machines.length > 1 ? 'are' : 'is'} plugged in too` : ''
      return p && m ? `${p}, and ${m}.` : p ? `${p}.` : m ? `${m[0].toUpperCase()}${m.slice(1)}.` : ''
    },
    welcomeReady: (name: string): string => `${name} is already connected, so let’s start: tell me what you’d like to make, a game, a website, a small tool, a question about your code…`,
    welcomeClaude: (chatgpt: boolean): string =>
      chatgpt ? 'To start, my agents need an AI subscription, Claude or ChatGPT, your pick. Claude?' : 'To start, my agents need a Claude subscription. Got one?',
    welcomeChatgpt: 'ChatGPT? [Connect it](/#do=codex).',
    welcomeNoClaude: 'No subscription yet? [Pick a Claude plan](https://claude.com/pricing), then come back here.',
    welcomeClaudeLink: 'To start, connect your Claude account, just once: the link comes right below.',
    welcomeClaudeInstall: (host: string): string => `To start, I’m installing Claude Code on ${host}, then you connect your Claude account: the link follows in a minute.`,
    welcomeCodex: 'To start, connect your ChatGPT account, through Codex: the code comes right below.',
    welcomeGuest: 'Any question meanwhile? Just ask.',
    claudeReadyJob: 'Claude is signed in: I’m starting what you asked.',
    claudeReady: 'Claude Code is signed in: I’m ready. Tell me what you want to do, like “create a repo for my idea about…” or “where’s my project at?”.',
    claudeOk: 'Claude Code is signed in on this machine.',
    notLoggedShort: 'For everything else, I need Claude Code signed in on this machine.',
    providerUnavailable: (name: string) => `Connecting ${name} is not available on this machine.`,
    providerLater: (name: string) => `For the rest, I need ${name} signed in first.`,
    codexPrimaryReady: 'Codex is connected: I’m ready. Tell me what you want to do.',
    codexReady: 'Codex is ready: say “with codex” and I’ll open the session in it.',
    codexInstalling: (host: string): string => `Installing Codex on ${host}…`,
    codexTerminal: (why: string, line: string): string => `I can’t sign Codex in from here (${why}). In a terminal on this machine, type \`${line}\`: I’ll notice on my own.`,
    codexCode: (url: string, code: string): string =>
      `To sign Codex in to your ChatGPT account: open [this page](${url}), sign in and type the code ${code} (valid 15 minutes). I’ll let you know as soon as it’s done.`,
    codexFail: (why: string): string => `Codex didn’t sign in (${why}). Tell me when you want to try again.`,
    joinLine: (line: string): string =>
      `On your other computer, open a terminal and paste this line:\n\n\`${line}\`\n\nIt works once, for an hour. I’ll tell you here when that computer is plugged in.`,
    joinKey: (id: string): string => `${id} is plugging in: weevils is installing there, a few minutes.`,
    joinOnline: (name: string): string => `[[win]]**${name} is plugged in**: I can run agents there now.`,
    linkDown: (name: string): string => `${name} has not answered for 10 minutes. If it is on, run \`weevils-service restart\` on it.`,
    linkBack: (name: string): string => `${name} is connected again.`,
    joinFailed: (id: string, why: string, fix: string): string =>
      `${id} failed to install: ${why}${fix ? `\n\nOn ${id}, run \`${fix}\`, then ask me for a new line.` : '\n\nAsk me for a new line to try again.'}`,
    connectorNeedsHttps: (url: string): string =>
      `ChatGPT and Claude.ai only reach me at a public https address, and right now I’m at ${url}. Ask me to make me reachable from anywhere: we’ll plug it in right after.`,
    connectorHow: (url: string, tunnel: boolean): string =>
      `Add this address to your chat app: \`${url}\`\n\n- Claude.ai: Settings → Connectors → Add custom connector, paste it, then Connect.\n- ChatGPT: Settings → Apps & Connectors → Advanced settings, turn on developer mode, then Create and paste it.\n\nIt asks once for your weevils access code.${tunnel ? ' This address changes when the machine restarts: to keep it, you’ll need a domain name.' : ''}`,
    delegated: 'I’ve handed it to an agent: it asks for your OK in the app before each step.',
    githubPitch: 'Plug in GitHub: I’ll see all your repos (swipe the feed left), create new ones for your ideas, and sort sessions by project.',
    githubAsk: (s: SetupState): string =>
      s.github.logged
        ? `GitHub is plugged in${s.github.login ? ` (${s.github.login})` : ''}. Swipe the feed left to see your repos; the + puts one in the feed.`
        : `With GitHub plugged in, I see all your repos, create new ones for your ideas, and sort sessions by project. Create a token on [this GitHub page](${GH_TOKEN_URL}) (“Generate token” at the bottom), copy it, and paste it below.`,
    githubOk: (login: string): string => `GitHub plugged in: ${login}. I can create repos for your ideas.`,
    githubFail: (why: string): string => `GitHub rejects this token (${why}). Check it has the repo and read:org scopes, then try again:`,
    githubNoCli: (why: string): string => `I kept the token, but the GitHub tool won’t install on the machine (${why}): ask me to try again.`,
    githubDevice: (url: string, code: string): string => `Sign in to your GitHub, just once: open [github.com/login/device](${url}) and type this code: **${code}** (valid 15 minutes). I’ll carry on as soon as it’s done.`,
    githubDeviceFail: (why: string): string => `GitHub didn’t sign in (${why}). Tell me when you want to try again.`,
    githubDeviceDone: 'GitHub is connected.',
    syncStart: 'You’re connected to GitHub and Claude. I’m syncing your conversations so you can pick them up from any machine or subscription.',
    syncDone: (n: number): string => `[[win]]**Done**: ${n > 1 ? `your ${n} conversations are` : n === 1 ? 'your conversation is' : 'your conversations are'} yours now, safe on your GitHub. 🎉 Keep your [recovery code](/#do=recovery) somewhere safe: with it, a new machine gets everything back.`,
    vpsOffer: 'To keep weevils working 24/7, even with your computer off, I recommend a server (about €5/month). I can [set it up now](/#do=server), or [remind you later](/#do=later).',
    vpsLater: 'Sure, I’ll bring it up again when it helps.',
    recoveryCode: (words: string): string => `Your recovery code, to keep like a password (with it, a new machine gets all your conversations back):\n\n\`${words}\``,
    recoveryShown: 'Your recovery code was already shown, above: I won’t write it again.',
    welcomeGithub: '[Connect your GitHub](/#do=github) and I’ll keep all your conversations there, yours.',
    voiceAsk: (s: SetupState): string => {
      const spoken =
        s.voice.spoken === 'cartesia'
          ? 'My voice goes through Cartesia, the most natural one.'
          : s.voice.spoken === 'edge'
            ? 'I already answer out loud (free voice). For a more natural voice, paste a Cartesia key below ([play.cartesia.ai/keys](https://play.cartesia.ai/keys), free tier to start).'
            : 'I don’t have a voice yet: I’m installing the free one. For a more natural voice, paste a Cartesia key below ([play.cartesia.ai/keys](https://play.cartesia.ai/keys)).'
      const dict = s.voice.openai
        ? s.voice.https
          ? ' Dictation is on: tap the logo to talk to me.'
          : ' Dictation is on, but the phone’s microphone needs an https address. [[setup:reach]]'
        : ' To dictate your messages, I need an OpenAI key (a few cents a day, [platform.openai.com/api-keys](https://platform.openai.com/api-keys)).'
      return `${spoken}${dict}`
    },
    voiceFreeOk: 'The free voice is installed: I answer out loud.',
    voiceFreeFail: (why: string): string => `The free voice won’t install (${why}). A Cartesia key works with nothing to install:`,
    voiceOk: (what: string[]): string => `Saved and checked: ${what.join(', ')}. Tap the logo to talk to me: once to talk, once to stop, once to send.`,
    voiceFail: (who: string, why: string): string => `${who} rejects this key (${why}). Try again:`,
    voiceNothing: 'Nothing changed.',
    devilAsk: (plugged: boolean, model: string): string =>
      plugged
        ? `The devil is plugged into ${model}. Tap it to switch (the band turns orange, its answers come in green), again to come back. To change the model:`
        : 'The devil sends your messages to another model, unfiltered, in this same thread: for example an “abliterated” model you run at home (Ollama, LM Studio, vLLM) or rent (OpenRouter, RunPod…), as long as it speaks the OpenAI API. I need its address, its name and its key: I’ll ask one at a time, they stay on your machine.',
    devilOk: (model: string, ms: number): string => `Plugged in: ${model} answers (${ms} ms). Tap the devil to switch: the band turns orange, its answers come in green, in this same thread.`,
    devilNoModel: (model: string, list: string): string => `The server answers, but it has no “${model}”. It offers: ${list}. Try again with one of them:`,
    devilFail: (why: string): string => `I can’t reach the model (${why}). Check the address (it often ends in /v1) and that its machine is on, then try again:`,
    mailPitch: 'Want to talk to me from ChatGPT, another agent, or any tool that sends e-mail? Plug in the e-mail bridge: every sender you allow writes to me, signed with their name and color, and I answer them in the same thread.',
    mailAsk: 'You need a Gmail inbox with 2-step verification (myaccount.google.com/signinoptions/twosv). Create an app password named “weevils” at myaccount.google.com/apppasswords and keep it handy: I’ll ask for your Gmail address, then that password. I take care of the +weevils alias, no filter to create.',
    mailOk: (alias: string): string =>
      `Bridge plugged in: ${alias}. Nothing to set up in Gmail: mail sent to this address reaches me directly, and I never read the rest of your inbox. Now tell me who may write to me:`,
    mailFail: (why: string): string => `Gmail refuses the connection (${why}). Check the address and the app password (16 letters), then try again:`,
    authorAsk: 'Who may write to me? Give me their name (shown on their messages), the address they write from, and a color if you like (otherwise I’ll pick one).',
    authorOk: (name: string, email: string, alias: string): string =>
      alias ? `${name} may write to me from ${email} at ${alias}: their messages come signed with their name. Another one?` : `${name} will be able to write to me from ${email} once the e-mail bridge is plugged in:`,
    authorBad: 'I need a name and a valid e-mail address. Try again:',
    authorShared: (id: string): string =>
      `That’s your own account: it names itself in each mail, “[${id}]” in the subject or “— ${id}” as a signature, and its messages come under its name. Without a name, it’s you writing to me.`,
    authorPending: (names: string[]): string =>
      `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} declared without an e-mail address, so ${names.length > 1 ? 'they' : 'it'} can’t write to me yet. Give me ${names.length > 1 ? 'their addresses' : 'its address'} first (same name, the color stays).`,
    quotaAsk: (lines: string[]): string =>
      lines.length
        ? `Your plan: ${lines.join(' · ')}. When a quota gets close to its limit, I hand the work to the other agent if you have both. [[setup:codex]]`
        : 'I can’t read your quota yet: it shows up once Claude Code (or Codex) is signed in and has been used once.',
    quotaLine: (tool: string, plan: string, parts: string): string => `${tool}${plan ? ` ${plan}` : ''} ${parts}`,
    quotaWindow: (kind: string, pct: number): string => `${kind === 'session' ? 'session' : kind === 'week' ? 'week' : kind} ${pct}%`,
    securityAsk: (s: SetupState): string =>
      [
        'Your access code is a full key to this machine: anyone who has it can drive your agents. Never send it to anyone.',
        s.security.exposedHttp ? 'Careful: I’m reachable over http, the code travels in clear text. Switch to https: [[setup:reach]]' : s.security.https ? 'The address is https: good.' : 'I only listen on this machine: nothing is exposed.',
        s.security.safe ? 'Your agents ask for permission before acting.' : 'Your agents run without asking for permission: fast, and one more reason to keep the code to yourself.',
        'To change the code and sign every device out, just ask me.',
      ].join(' '),
    historyAsk:
      'Your Claude Code and Codex conversations stay on the computer where they ran. On that computer, paste the line below in a terminal: they show up here, you tap the ones to bring, and they carry on here with everything they knew. [[setup:history]]',
    shortcutAsk:
      'On iPhone, a Shortcut lets you talk to me without opening the app: “Hey Siri, weevboss”, or the Action button. Tap the button: I copy your personal address, then in the Shortcuts app, + and these actions:\n\n1. “Dictate Text”\n2. “Get Contents of URL”: paste the address, Method POST, Request Body JSON, field text = Dictated Text\n3. “Get Dictionary Value”: key say\n4. “Speak Text”\n\nName it “weevboss”: Siri finds it on its own.',
    shortcutOk: 'Address copied: paste it in the “Get Contents of URL” action.',
    installHave: (os: string, have: string[]): string => `On ${os}, already there: ${have.join(', ')}.`,
    installMissing: (missing: string[]): string => `Missing: ${missing.join(', ')}. One tap on each, I install it and sign it in.`,
    installAll: 'All the essentials are there.',
    installIntro: (os: string, missing: boolean): string =>
      missing ? `On ${os}, here’s what’s missing, in order. Run these commands yourself, never hand them to the user:` : `On ${os}, all the essentials are already there.`,
    installDone: 'Already installed:',
    installLogins: 'Then the sign-ins: offer the chip [[setup:claude]], [[setup:github]] or [[setup:codex]], never a command.',
    keySaved: (name: string) => {
      const { brand, token } = secretBrand(name)
      return `${brand} ${token ? 'token' : 'key'} saved on this machine (never shown). The agent that asked for it can use it.`
    },
    keyTyped: (name: string) => {
      const { brand, token } = secretBrand(name)
      return `my ${brand} ${token ? 'token' : 'key'}: ••••`
    },
    badSecret: 'key or value refused',
    installNoSudo: 'No sudo here: these commands install into the user’s home folder.',
    installNoBrew: (clone: string): string =>
      `Homebrew is missing on this Mac, and it is what installs the base tools and Node.js. Run \`${clone}/install.sh --agent\` yourself (step 4 of ${clone}/AGENTS.md): it installs Homebrew, or says in its summary what the user has to do when it needs the Mac password.`,
    needClaude: 'Sign Claude Code in first: I’ll take care of it after that.',
    needSudo: 'For that I need admin rights on this machine, and I don’t have them here. Ask whoever runs it, or plug in a VPS of your own:',
    working: 'On it.',
    saved: 'saved',
    masked: (tail: string): string => `••••${tail}`,
    detected: 'I see it: it’s plugged in.',
    badBrick: 'unknown setup',
    localOnly: 'only from the machine itself',
    badKey: 'setting not editable here',
    noQr: 'qrencode is not installed',
    badValue: (field: string): string => `missing answer: ${field}`,
    badProject: (name: string): string => `not a project name: “${name}” (lowercase letters, digits and dashes)`,
    field_url: 'address',
    field_model: 'model',
    field_key: 'key',
    field_cartesia: 'Cartesia key',
    field_openai: 'OpenAI key',
    field_token: 'token',
    field_gmail: 'Gmail',
    field_password: 'password',
    field_name: 'name',
    field_email: 'e-mail',
    field_color: 'color',
    field_code: 'code',
    field_provider: 'host',
    field_host: 'address',
    field_user: 'user',
    field_domain: 'domain',
    voiceName: 'the voice',
    gb: (n: number): string => `${n} GB`,
    prov_none: 'I don’t have one',
    prov_other: 'other',
    otherHost: 'your host',
    noAnswer: 'no answer',
  },
})
