import type { Ask } from './asks.ts'
import type { ForYouMark } from './foryou.ts'

// Contrat entre weevilsd (VPS) et l'app. Horodatages en millisecondes, compteurs toujours dérivés côté app.

export type Tool = 'claude' | 'codex'
/** How agents work: on their own (no permission prompt, the default) or asking the person before acting. */
export type AgentMode = 'auto' | 'ask'
/** The global choice (Your factory > Intelligence > Agents), every machine follows the main one's. locked: this machine
 *  runs weevils as root, where Claude Code refuses to work without asking. */
export interface AgentsChoice { ask: boolean; locked?: 'root' }
/** interrupted : coupée en plein travail (processus mort, pane fermée, erreur d'API ou quota), jamais confondue avec done. */
export type SessionStatus = 'working' | 'needs_user' | 'idle' | 'done' | 'interrupted'

/**
 * Pourquoi une session est « interrupted » : died (processus ou pane disparus en plein tour, ou avec du travail
 * d'arrière-plan en cours), dirty (arrêtée sans fin propre avec du travail non commité), quota (limite d'usage),
 * auth (connexion expirée), api (autre erreur d'API ou de compaction qui a arrêté le tour).
 */
export type InterruptReason = 'died' | 'dirty' | 'quota' | 'auth' | 'api'

/** Verified target context, independent of request origin, current activity or successful results. */
export interface WorkstreamIdentity {
  kind: 'self-improvement'
  installationId: string
  target: { machineId:string; projectId:string; repo:string }
  evidence: 'repository-identity' | 'automation-target'
}

export interface Message {
  /** Verified runtime source; never inferred from the visible prose. */
  sourceThreadId?: string
  /** Incoming technical coordination from the session bridge; boss briefs remain visible. */
  coordination?: boolean
  /** Sanitized command details, never raw orchestration code. */
  toolDetails?: { calls?: {name:string;description?:string}[]; summaryCommands?: string[]; commands: string[]; kinds?: string[]; commandsTruncated?: boolean; output?: string; outputTruncated?: boolean; /** Claude tool calls: the arguments a title is made from (redacted, short). */ args?: { file?: string; lines?: string; pattern?: string; path?: string; url?: string; query?: string } }
  id: string
  /** orchestrator : message signé par un autre auteur que l'utilisateur (weevboss, ou un agent externe : voir author). */
  role: 'user' | 'assistant' | 'orchestrator' | 'event'
  /** role orchestrator : id de l'auteur (Snapshot.config.authors) ; absent = weevboss. */
  author?: string
  text: string
  at: number
  /** Échange du devil mode (autre modèle, même fil que weevboss). */
  devil?: boolean
  /** Fil de weevboss : les puces de branchement de ce message ([[setup:x]], retirées du texte), montrées en boutons. */
  chips?: string[]
  /** role orchestrator, long brief: the one spoken line the thread shows in its place (the full text stays a tap away). */
  say?: string
  /** A message the person (or another author) wrote: what is being done with it, one emoji on its corner (server/reactions.ts:
   *  from the request ledger, weevboss's turn, the session's state, or an agent's explicit `weevils react`). */
  reaction?: string
  /** weevboss's thread, a message whose reaction is ❓: the session that waits on the person (its question). */
  waitingOn?: string
  /** This message announces a real win, proven by runtime state (never by its wording): the app celebrates it once. */
  win?: Win
}

/** A real win: a conversation moved to another machine with its history, a machine joining for the first time, a
 *  request verified done, work landed on main, the vault in sync. id is stable per event (it fires once); at is when
 *  it happened. */
/** said: a result weevboss verified and marked in its reply ([[win]]**…**, shared/wins.ts). */
export type WinKind = 'move' | 'machine' | 'done' | 'land' | 'vault' | 'said' | 'step'
export interface Win {
  id: string
  kind: WinKind
  at: number
}

/** Qui peut signer un message dans une session, à part l'utilisateur : weevboss et les agents externes (config du serveur). */
export interface Author {
  id: string
  name: string
  /** Couleur CSS de ses messages ; vide = le violet de weevboss. */
  color: string
}

/**
 * Travail lancé par une session et qui tourne à côté d'elle : sous-agent (outil Agent/Task), étape d'un workflow
 * (outil Workflow, un sous-agent par étape) ou commande lancée en arrière-plan (Bash run_in_background).
 */
export interface Subagent {
  id: string
  /** agent : sous-agent Agent/Task ; step : étape d'un workflow ; shell : commande en arrière-plan. */
  kind: 'agent' | 'step' | 'shell'
  /** Son nom : description de l'agent, label de l'étape (« build:page »), description de la commande. */
  label: string
  /** Ce qu'il fait en ce moment (dernier outil utilisé, dernière phrase) ; sa tâche quand il a fini. */
  activity: string
  /** Étapes de workflow : nom du workflow et phase de l'étape. */
  workflow?: string
  phase?: string
  /** working : tourne encore ; done : fini ; failed : fini en erreur ; stopped : coupé avant la fin (processus mort, arrêté). */
  status: 'working' | 'done' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
}

/** Détail d'un sous-agent, à la demande (GET /api/sessions/:id/subagents/:subId) : ses derniers pas, du plus ancien au plus récent. */
export interface SubagentDetail {
  subagent: Subagent
  steps: { at: number; role: 'assistant' | 'tool' | 'result'; text: string }[]
}

/** Réglages d'une session tels que l'outil les écrit dans son transcript (inconnus quand absents). */
export interface SessionSettings {
  /** claude : opus / sonnet / haiku (ou l'id complet) ; codex : gpt-… */
  model?: string
  /** codex : on-request, never, untrusted… */
  approval?: string
  /** claude : low / medium / high / max, lu dans les requêtes du transcript. */
  effort?: string
}

export interface SessionProgress {
  kind?: 'render'
  pauseReason?: 'worker-stopped' | 'capacity' | 'retry-stopped'
  verified?: number
  source: 'remote'
  label: string
  state: 'working' | 'waiting' | 'done' | 'error'
  updatedAt: number
  staleAfterMs: number
  completed?: number
  total?: number
  detail?: string
  /** Observed counter change, never inferred from the observer heartbeat. */
  lastProgressAt?: number
}

export interface Session {
  /** Local source launch policy, independent of identity and transport controllability. */
  sourceAccess?: SourceAccess
  /** Target identity only: never use this as an Automated sender or activity/completion signal. */
  workstream?: WorkstreamIdentity
  progress?: SessionProgress
  /** Hidden from the ordinary list; the agent keeps running and can be restored. */
  archived?: boolean
  id: string
  projectId: string
  repo: string | null
  machineId: string
  tool: Tool
  title: string
  /** Ce que la session fait en ce moment (dernier bloc), une phrase courte. Écrit par le renommeur. */
  now?: string
  status: SessionStatus
  /** Ce qui t'attend (permission, question), quand status = needs_user. */
  attention?: string
  /** Stable notification event, independent of screen refreshes and background activity. */
  noticeId?: string
  /** Live selector options; ids are validated against the current screen before choosing. */
  choices?: { id: string; label: string }[]
  /** What exactly the question is about (the command, the reason), in plain words, when the dialog says it. */
  attentionDetail?: string
  /** status = needs_user sans dialogue : le tour fini sur une question ou une demande (shared/asks.ts), pour l'action rapide. */
  ask?: Ask
  /** status = done or idle, and its last message still ends on a real « Needs you: » line (shared/run-line.ts
   *  needsLine): what it asks, one plain sentence. The row shows it waits; never a notification, a card or a wake-up. */
  asksYou?: string
  /** status = interrupted : quand et pourquoi (detail : le message d'erreur de l'outil, s'il y en a un). */
  interrupted?: { at: number; reason: InterruptReason; detail?: string }
  cwd: string
  branch?: string
  openedAt: number
  lastActivityAt: number
  /** Début du travail en cours ; null quand la session ne travaille pas. */
  workStartedAt: number | null
  /** weevils (lancée depuis l'app), terminal, headless… */
  origin: string
  /** weevils peut lui écrire (pane zellij pilotée, ou reprise headless possible). */
  controllable: boolean
  /** Un processus tourne encore. */
  live: boolean
  /** weevils voit son écran (pane zellij pilotée). */
  hasScreen: boolean
  subagents: Subagent[]
  /** Nombre de sous-agents, étapes de workflow et commandes d'arrière-plan qui tournent encore (0 : rien). Tant qu'il est > 0 et
   *  que le processus vit, la session est « working » : jamais « idle »/« done », jamais fermée par le ménage des panes. */
  background: number
  /** Le tour principal travaille, arrière-plan exclu (le pont e-mail attend la réponse, pas la fin des sous-agents).
   *  Absent d'un weevilsd plus ancien : status fait foi. */
  turnWorking?: boolean
  lastMessage?: string
  messageCount: number
  settings?: SessionSettings
  /** Messages reçus pendant que la session travaille, pas encore traités. */
  queued: number
  /** Session Codex ouverte en relais d'une session Claude arrêtée par la limite d'usage : l'id de cette session (server/relay.ts). */
  relayOf?: string
  /** Session Claude dont une session Codex a pris le relais : l'id de cette session Codex. */
  relayedBy?: string
  /** With WEEVILS_THREADS: the weevbook thread this session carries. One thread is one row, whatever engine runs it. */
  thread?: string
  /** Its machine does not answer now: the row is what was synced (server/offline-machines.ts), readable, not live. */
  offline?: boolean
  /** Its own permission choice, set from its page (server/agent-modes.ts); absent: it follows the global one. */
  agentMode?: AgentMode
  /** Its machine runs weevils as root: it always asks (Claude Code refuses otherwise). */
  agentLocked?: boolean
}

/** Relais Codex quand Claude atteint sa limite : auto (Codex écrit son plan puis l'exécute), ask (le plan attend un oui), never. */
export type RelayMode = 'auto' | 'ask' | 'never'

/**
 * Plan de reprise d'une session arrêtée par la limite d'usage de Claude, écrit par Codex en lecture seule.
 * preparing : Codex lit le contexte ; ready : le plan attend une décision ; failed : Codex n'a pas pu l'écrire ;
 * running : validé, une session Codex (relayTo) fait le travail ; waiting : on attend le retour de Claude.
 */
export interface RelayPlan {
  /** This request has been answered; a rewritten or failed plan opens a new request. */
  resolved?: boolean
  sessionId: string
  title: string
  projectId: string
  state: 'preparing' | 'ready' | 'failed' | 'running' | 'waiting'
  /** Le plan (fait, reste, risques, ce que Codex compte faire). */
  text?: string
  /** Une version plus à jour est en cours d'écriture (plan préparé avant la coupure, ou ajustement demandé). */
  refreshing?: boolean
  error?: string
  at: number
  /** Tâche de la bande auto. */
  auto?: boolean
  relayTo?: string
}

/** Ce que l'app montre du relais (server/relay.ts). */
export interface RelayView {
  mode: RelayMode
  /** Codex is installed, connected and has no recorded quota block. Unknown quota is not proof of availability. */
  codex: boolean
  providers?: Record<Tool, { canAttempt: boolean; observedAt?: number; stopAt?: number; block?: { since: number; resetAt: number | null; source: 'quota' | 'transcript' } }>
  handoffs?: { sourceId: string; targetId: string; at: number; sourceAt: number; title: string; phase: 'waiting' | 'dispatching' | 'uncertain' | 'done' | 'cancelled'; auto: boolean; main?: boolean }[]
  /** Seuil de bascule préventive, en % de la fenêtre (5 h ou semaine). */
  switchAt: number
  /** Claude est indisponible ou tout près de sa limite : near (seuil atteint), limit (limite atteinte), down (erreurs d'API répétées). */
  limit?: { kind: 'near' | 'limit' | 'down'; since: number; until: number | null; percent?: number; window?: 'session' | 'week' }
  /** weevboss répond par Codex en ce moment. */
  boss?: boolean
  plans: RelayPlan[]
  /** Several Claude accounts of the user's own (server/claude-accounts.ts), when turned on: one line each. */
  accounts?: ClaudeAccountLine[]
}

/** One Claude account: « account 2 · name · 42% ». percent null: not read yet. */
export interface ClaudeAccountLine {
  id: string
  n: number
  label: string
  plan?: string
  percent: number | null
  resetsAt: number | null
  active: boolean
  logged: boolean
}

/** Observed local policy, not GitHub permissions or an agent sandbox. Absent means unknown. */
export interface SourceAccess {
  repo: string | null
  machineId: string
  canExecute: boolean
  reason: 'owned-writable' | 'not-owned' | 'not-writable' | 'unavailable' | 'no-checkout'
}

/** Installation identity is visible even without source, and never proves work or repository ownership. */
export interface InstallationInfo {
  id: string
  machineId: string
  source: 'checkout' | 'artifact'
}

export interface Project {
  installation?: InstallationInfo
  sourceAccess?: SourceAccess
  /** Target identity only: never use this as an Automated sender or activity/completion signal. */
  workstream?: WorkstreamIdentity
  id: string
  name: string
  /** An installation entry is informational: no source repository or session target is implied. */
  kind: 'repo' | 'invented' | 'installation'
  repos: string[]
  /** Machine qui porte chaque repo (fichiers, nouvelle session). */
  where: Record<string, string>
  lastActivityAt: number
}

/** Un repo GitHub du compte. */
export interface GithubRepo {
  name: string
  description: string
  isPrivate: boolean
  pushedAt: number
  language?: string
  /** Ce que c'est, en une phrase humaine (écrite une fois par weevils, en cache). */
  blurb?: string
}

export interface Machine {
  id: string
  name: string
  online?: boolean
  /** Turned off in Your factory: nothing new starts there. */
  off?: boolean
  /** A machine of yours that does not answer: why, as this one sees it, and since when. */
  away?: MachineAway
  /** Claude Code on that machine, as its own weevilsd sees it (absent: not answering, or an older weevils there). */
  claude?: { installed: boolean; logged: boolean }
}

/** Why another machine does not answer:
 *  - joining: its line was pasted, weevils is installing there (it shows up by itself when done);
 *  - failed: that install stopped (detail: why; fix: the command that fixes it, when there is one);
 *  - link: nothing reaches it (it is off or asleep, or weevils on it lost its link to this one);
 *  - stopped: its link is there, but weevils on it does not answer (stopped, or still starting);
 *  - port: another program on this machine holds its tunnel port (weevils moves it at its next connection);
 *  - key: it answers, but refuses this machine (its key changed: an update or a new line puts it back). */
export interface MachineAway {
  why: 'joining' | 'failed' | 'link' | 'stopped' | 'port' | 'key'
  /** The last time it answered (ms), or when its line was pasted (joining, failed); null: never seen. */
  since: number | null
  detail?: string
  fix?: string
}

export interface H24Activity {
  id: string
  title: string
  kind: 'timer' | 'job'
  projectId: string | null
  schedule: string
  enabled: boolean
  runState: 'running' | 'waiting' | 'paused'
  runStartedAt: number | null
  lastEvent: string
  canToggle: boolean
  /** Bande auto, d'un coup d'œil : prochaine exécution, période (lue dans le planning), dernière exécution, depuis quand
   *  la tâche existe, et la famille de son nom (projet probable, pour la ranger). */
  nextRunAt?: number | null
  everyMs?: number | null
  lastRunAt?: number | null
  since?: number | null
  group?: string
  /** Timer : la Description= de son unité (à quoi il sert). */
  description?: string
  /** Dernier passage : durée et issue ; nombre de passages connus (journal). */
  lastDurMs?: number | null
  lastOk?: boolean | null
  runCount?: number | null
}

/** Conversation ChatGPT / Claude.ai importée (sans ses messages). */
export interface ConversationSummary {
  id: string
  source: 'chatgpt' | 'claude'
  title: string
  projectId: string | null
  updatedAt: number
  messageCount: number
  preview: string
  /** new : pas encore vue ; auto : rangée par weevils ; pending : à ranger par toi ; accepted / corrected : ton choix ; none : laissée de côté. */
  status: 'new' | 'auto' | 'pending' | 'accepted' | 'corrected' | 'none'
  suggestedProjectId?: string
  reason?: string
  confidence?: number
}

export interface ConversationDetail {
  conversation: ConversationSummary
  messages: Message[]
}


// ---------------------------------------------------------------- mémoire, weevils volants, h24 qui ne dort jamais

/** Ce que weevils retient de l'utilisateur : ~/.config/weevils/memory.json (hors de tout repo, envoyé seulement au modèle). */
export interface MemoryItem {
  id: string
  /** Le souvenir, en une phrase courte (« veut lancer un jeu mobile cette année »). */
  text: string
  /** answer : tiré d'une réponse à un weevil volant (le reste même corrigé à la main) ; manual : ajouté à la main. */
  source: 'answer' | 'manual'
  /** source answer : la question portée par le weevil et la réponse d'où vient ce souvenir. */
  q?: string
  a?: string
  at: number
  updatedAt: number
}

/** Une tâche du h24 (« optimiseur ») : proposée à partir de la mémoire et des projets, lancée quand la machine est libre. */
export interface Optimizer {
  sourceAccess?: SourceAccess
  /** Target identity only: never use this as an Automated sender or activity/completion signal. */
  workstream?: WorkstreamIdentity
  /** Explicit recovery event: reconcile an old optimistic refusal, never infer delivery/deletion from text. */
  recoveredAt?: number
  software?: { id:string; repository:string; revision:string; status: 'ready'|'pending-running'; legacyWorkspace:string; excluded:string[] }
  id: string
  /** Ce que la tâche fait, très court (« muscler les tests de mon-app »). */
  title: string
  /** Pourquoi elle est proposée, une phrase (le lien avec un souvenir ou un projet). */
  why: string
  /** Its job in one plain sentence: the person's standing authorization. A run that stays inside it lands on its own
   *  (server/auto-merge.ts ScopeJudge); written once from what the person set it up for, then kept. */
  scope?: string
  /** Repo où elle tourne (null : dans son propre dossier de travail, hors repo). */
  repo: string | null
  kind: 'tests' | 'watch' | 'content' | 'explore' | 'other'
  /** The family it sits in, in the drawer (« Content », « Code quality »): one band per family that opens onto its
   *  automations. None set anywhere: the drawer stays one flat list. */
  group?: string
  /** Builds, tests, installs : lancés via heavy quand il existe. */
  heavy: boolean
  /** proposed : attend un oui ou un non ; queued : acceptée, attend une machine libre ; running ; done ; failed ; refused. */
  state: 'proposed' | 'queued' | 'running' | 'done' | 'failed' | 'refused'
  /** Conversation de création encore à préciser : aucune exécution ni validation tant que true. */
  draft?: boolean
  /** Créée à l'initiative de l'utilisateur (+), distincte des suggestions automatiques plafonnées. */
  userCreated?: boolean
  /** Session de l'agent qui la fait tourner (visible dans son projet). */
  sessionId?: string
  /** Its runs' sessions the person took over by writing into them (server/optimizers.ts handOver): ordinary sessions
   *  of theirs since, never folded back under the automation. Absent from an older server. */
  handedOver?: string[]
  createdAt: number
  startedAt?: number
  endedAt?: number
  /** Dernière nouvelle (fin de la réponse de l'agent, raison d'attente…). */
  lastEvent?: string
  /** 1 forte … 3 faible. */
  priority?: 1 | 2 | 3
  /** Durée estimée, en minutes. */
  est?: number
  /** queued : ce qu'elle attend (busy : un agent travaille ; load : machine chargée ; ram : mémoire ; queue : une autre tâche d'abord ;
   *  later : arrêtée par une limite d'usage ou une erreur, nouvel essai à retryAt ; time : son heure, à startAt ;
   *  sleep : déclenchée « quand je dors », attend le prochain mode sommeil). */
  waiting?: 'busy' | 'load' | 'ram' | 'queue' | 'later' | 'time' | 'paused' | 'sleep'
  /** waiting later : quand elle sera relancée. */
  retryAt?: number
  /** Conditions négociées : pas avant (instant), chaque jour dans une fenêtre (minutes après minuit, heure de tz), toutes les every ms. */
  notBefore?: number
  window?: { from: number; to: number }
  every?: number
  /** Fuseau de l'utilisateur (envoyé par le téléphone) où se lisent notBefore et window. */
  tz?: string
  /** queued, retenue par ses conditions d'heure : quand elle pourra partir. */
  startAt?: number
  /** La négociation (POST /api/optimizers/:id/talk), les dernières lignes, gardée après validation : d'où vient la tâche. */
  talk?: OptimizerLine[]
  /** Ce que la dernière réécriture a changé (l'app fait clignoter ces champs). */
  changed?: { at: number; fields: OptimizerField[] }
  /** Version : +1 à chaque réécriture ; ✓ valide celle-ci (accept { rev }). */
  rev?: number
  /** Tâche récurrente en cours : la portée convenue pour son prochain passage (son titre alors), si elle change. */
  next?: { title: string }
  /** Chaque passage (le plus récent en premier, 30 au plus) : unique ou récurrente. Les anciens { at, ok, note } restent lisibles. */
  runs?: AutoRun[]
  /** Nombre total de passages (jamais plafonné). */
  runCount?: number
  /** Jetons consommés, tous passages confondus. */
  tokens?: number
  /** Trigger « when I sleep »: one run each time sleep mode turns on (its other times are ignored). */
  onSleep?: boolean
  /** With onSleep: a run still going when the user wakes is stopped then. */
  stopOnWake?: boolean
  /** Mise en pause par l'utilisateur : le runner la saute (waiting 'paused'). */
  paused?: boolean
  /** Départ immédiat demandé : attend seulement la machine, sans répéter le bouton de départ. */
  runRequested?: boolean
  /** Validée à cet instant (début du remplissage de la page auto). */
  acceptedAt?: number
  /** Automatisation intégrée à weevilsd (server/cost.ts) : elle tourne dans le serveur, sans session d'agent. */
  builtin?: 'cost'
  /** Its stable short name in the mother folder (docs/automations/PROTOCOL.md). */
  name?: string
  /** The weevils page its results live on (`<kind>/<slug>`): from its manifest, else the newest run that named one. */
  resultsPage?: string
}

/** Un passage d'une automatisation : at = fin, startedAt = début. */
export interface AutoRun {
  softwareId?: string
  sourceRevision?: string
  configRevision?: string
  at: number
  startedAt: number
  ok: boolean
  note?: string
  tokens?: number
  files?: number
  sessionId?: string
  /** The task's own branch, pushed to origin by weevils after this run. */
  pushed?: string
  /** The commit this run landed on main by itself (a safe kind: theme, copy, asset; server/auto-merge.ts). */
  merged?: string
  /** When the person wrote into this run's session: from then on it is an ordinary session of theirs (core.ts sendOne). */
  handedOver?: number
  /** From the run card it left beside its report (PROTOCOL.md, section 6): one line, its numbers, its results page. */
  summary?: string
  metrics?: Record<string, number>
  page?: string
}
/**
 * Who a message to a session comes from, told by the route that received it, never guessed from its words: 'user' is
 * the person (the app on a signed-in device, a For you tap, weevboss relaying the person with --for-user).
 */
export type RequestOrigin = 'user'
/** Un fichier produit ou modifié par un passage. abs : chemin absolu sur la machine (page fichier). */
export interface AutoOutputFile {
  path: string
  abs: string
  status: 'A' | 'M' | 'D' | 'R'
  add: number
  del: number
}
/** GET /api/auto/:id/runs/:at — ce qu'un passage a fait et produit. images : chemins servis par /api/auto/:id/blob?path=. */
export interface AutoRunDetail {
  run: AutoRun
  report?: string
  message?: string
  files: AutoOutputFile[]
  links: string[]
  images: string[]
  /** Timer ou job : les lignes de journal du passage. */
  log?: string
}
/** GET /api/auto/:id — l'historique d'une automatisation (tâche, timer ou job). */
export interface AutoDetail {
  id: string
  /** Le plus récent en premier. */
  runs: AutoRun[]
  /** Jetons du passage en cours. */
  liveTokens?: number
  machine: string
}

/** Un choix de conversation : son libellé et le message envoyé quand on le touche. */
export interface AutoSuggestion {
  label: string
  text: string
}

export interface OptimizerLine {
  who: 'user' | 'auto'
  text: string
  at: number
  /** Réponse qui a réécrit la tâche : les champs changés. */
  changed?: OptimizerField[]
  /** Suggestions pour répondre à cette question, jamais des commandes de création ou de validation. */
  suggestions?: AutoSuggestion[]
}

/** next : la portée du prochain passage (convenue pendant qu'elle tourne). */
export type OptimizerField = 'title' | 'why' | 'est' | 'priority' | 'heavy' | 'kind' | 'repo' | 'prompt' | 'notBefore' | 'window' | 'every' | 'onSleep' | 'stopOnWake' | 'next'

/** Sleep mode (server/sleep.ts): the user is asleep, the agents keep working as « ghosts ». GET/POST /api/sleep. */
export interface SleepState {
  on: boolean
  /** When it turned on (null while awake). */
  since: number | null
  /** The last night, once woken: from sleep to wake. */
  last?: { from: number; to: number }
}

/** Réponse de POST /api/optimizers/:id/talk : la réponse à afficher (et lire), la tâche telle qu'elle est maintenant. */
export interface OptimizerTalkReply {
  reply: string
  item?: Optimizer
  changed: OptimizerField[]
  /** Pas de modèle (échec, limite) : rien n'a changé, la question n'est pas gardée. */
  failed?: boolean
}

/** La machine vue par la bande auto : charge, mémoire libre, et ce qui retient une tâche acceptée (null : libre). */
export interface AutoMachine {
  load: number
  cpus: number
  freeGb: number
  wait: 'busy' | 'load' | 'ram' | null
}

export interface Snapshot {
  version: number
  now: number
  machines: Machine[]
  projects: Project[]
  sessions: Session[]
  h24: H24Activity[]
  conversations: ConversationSummary[]
  conversationCounts: { total: number; pending: number; byProject: Record<string, number> }
  /** Classement en cours (lots restants), pour l'afficher. */
  classifier: { running: boolean; queued: number; lastError?: string }
  /** La conversation avec weevils, l'orchestrateur (sa propre session Claude, cachée des projets). */
  main: Message[]
  mainWorking: boolean
  /** Réglages connus de la session de l'orchestrateur, et si on peut lui envoyer des commandes (/model…). */
  mainSettings?: SessionSettings
  mainHasScreen: boolean
  /** A question on weevboss's own screen (a permission, a menu), as plain words and answers; answered with its id. */
  mainQuestion?: { id: string; attention: string; attentionDetail?: string; choices: { id: string; label: string }[] }
  mainQueued: number
  /** Devil mode : modèle branché (DEVIL_API_URL) et réponse en cours. */
  devil: { enabled: boolean; working: boolean }
  /** Ce qui est branché (server/setup.ts) : les bulles renvoient vers weevboss quand un réglage manque. */
  setup?: { provider?: Tool; ready?: boolean; codex?: boolean; providers?: { claude: boolean; codex: boolean }; claude: boolean; voice: boolean; dictation: boolean; github: boolean; welcomed: boolean; /** The onboarding's sync is on its way (its line shows under weevboss's words). */ syncing?: boolean }
  /** Repos épinglés au fil des projets (présents même sans session). */
  pinnedRepos: string[]
  /** Projects taken out of the side bar in Your factory (they come back while one of their conversations works or
   *  needs you). */
  hiddenProjects?: string[]
  /** The side bar's other drawers pinned (true) or taken out (false) in Your factory (shared/drawers.ts). */
  sideDrawers?: Record<string, boolean>
  /** Conversations started with no repo pinned in the side bar, each its own band (Your factory). */
  pinnedSessions?: string[]
  /** Nombre de souvenirs (server/memory.ts) ; la liste se lit avec GET /api/memory. Absent hors machine principale (pas de mémoire). */
  memoryCount?: number
  /** Open requests in weevboss's ledger (server/boss-ledger.ts), main machine only. */
  asksOpen?: number
  /** Of those, the ones that wait on the person: the rows the requests list marks « needs you », counted by the same
   *  rule (shared/request-chip.ts waitingCount). Main machine only; absent from a server older than 2026-11-26. */
  asksWaiting?: number
  /** Tâches du h24 proposées, en attente, en cours ou finies récemment (server/optimizers.ts). Les refusées n'y sont pas. */
  optimizers?: Optimizer[]
  /** La machine vue par la bande auto (server/optimizers.ts), sur la machine principale. */
  autoMachine?: AutoMachine
  /** « Pour toi » (server/foryou.ts), sur la machine principale : révision du flux et nombre d'items pas encore vus. Le flux se lit avec GET /api/foryou. */
  foryou?: ForYouMark
  /** Relais Codex pendant la limite d'usage de Claude (server/relay.ts). */
  relay?: RelayView
  /** Un tour de propositions est en cours (la bande auto montre une place qui se remplit). */
  autoRound?: { busy: boolean }
  /** Sleep mode (server/sleep.ts), on the main machine. */
  sleep?: SleepState
  /** The theme picked for every device (server/theme-pref.ts); absent until someone picks one. */
  theme?: string
  /** How agents work, for every machine (server/ask-follow.ts); absent from an older weevilsd. */
  agents?: AgentsChoice
  /** The « pages » band of next's side bar (server/page-band.ts), in the order its pages joined. */
  pageBand?: BandPage[]
  /** Réglages de l'utilisateur utiles à l'app (fichier de config du serveur). */
  /** siteKey : clé des pages statiques des repos (/api/site/<clé>/<repo>/), pour le navigateur intégré sans domaine de preview. */
  /** threads: WEEVILS_THREADS is on (docs/spec, step 4): conversations are weevbook threads and nothing shows relays. */
  config: { userName: string; exposeDomain: string; publicHost: string; authors?: Author[]; siteKey?: string; autoUpdate?: boolean; threads?: boolean; /** TEMPORARY: the new interface's address (WEEVILS_NEXT_URL), src/ui/next-shortcut.tsx. */ nextUrl?: string }
}

/** A page of the « pages » band: a living link (shared/pages.ts), and the conversation that builds it when it was made
 *  there. */
export interface BandPage {
  slug: string
  title: string
  kind: import('./pages.ts').PageKind
  path: string
  session?: string
}

export interface SessionDetail {
  session: Session
  messages: Message[]
}

/** Une question posée depuis la vue d'un fichier ou un fil de conversation : le mot ou la sélection tapés, et ce qui les entoure. */
export interface ExplainRequest {
  mode: 'explain' | 'usage' | 'ask'
  /** file : vue d'un fichier (défaut) ; conv : fil d'une session ou de weevboss ; memory : page mémoire (path = id du souvenir, vide : toute la mémoire ; le serveur la relit lui-même) ;
   *  ui : n'importe quel texte de l'interface (title = l'endroit, around = le texte du bloc autour). */
  kind?: 'file' | 'conv' | 'memory' | 'ui'
  /** Repo du fichier ou de la session (vide pour le fil de weevboss). */
  repo: string
  /** file : chemin du fichier ; conv : vide. */
  path: string
  /** conv : titre de la conversation, outil (claude, codex, weevboss) et projet. */
  title?: string
  tool?: string
  project?: string
  machine?: string
  /** Texte sélectionné (vide : la question porte sur ce qui est affiché). */
  selection: string
  /** file : lignes de la sélection, numérotées à partir de 1 (conv : 0). */
  from: number
  to: number
  /** file : les lignes autour, numérotées (« 12│ code ») ; conv : les messages autour (« [auteur] texte »). */
  around: string
  /** mode ask : la question, écrite ou dictée. */
  question?: string
}

export interface UsageHit {
  path: string
  line: number
  text: string
}

export interface ExplainReply {
  text: string
  /** mode usage : les endroits où le mot apparaît dans le repo. */
  hits?: UsageHit[]
  /** La demande était une action : transmise au vrai weevboss (sa réponse arrive dans son fil). */
  forwarded?: boolean
}
