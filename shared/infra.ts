// Contrat du coin infrastructure : machines (charge, mémoire, disque, historique, conseils), système de fichiers,
// abonnements Claude / Codex. Horodatages en millisecondes, pourcentages de 0 à 100.

/** normal < 70 % CPU / 80 % mémoire ≤ warn < 90 % / 92 % ≤ crit. */
export type Level = 'ok' | 'warn' | 'crit'

/** Ce que montre l'icône d'une machine dans le coin. */
export interface MachineBrief {
  id: string
  name: string
  online: boolean
  /** CPU sur les dernières secondes et mémoire utilisée (hors cache), en %. */
  cpu: number
  mem: number
  level: Level
  /** weevboss (l'orchestrateur) tourne ici. */
  weevboss: boolean
}

/** Une minute de l'historique du jour. */
export interface InfraPoint {
  at: number
  cpu: number
  /** Pic de CPU dans la minute. */
  cpuMax: number
  mem: number
  /** Swap utilisé en % (null : pas de swap). */
  swap: number | null
  load: number
  /** Sessions claude / codex vivantes, et ce qu'elles prennent avec leurs sous-processus (Mo, % d'un cœur). */
  agents: number
  agentMem: number
  agentCpu: number
  /** Les familles de processus les plus gourmandes (docker, vitest, claude…), quand la machine chauffe. */
  top?: [string, number][]
}

export interface Episode {
  from: number
  to: number
  cpu: number
  mem: number
  /** Ce qui tournait le plus pendant la saturation. */
  culprit?: string
}

export interface ServerProc {
  port: number
  /** node, python, caddy… et le dossier (projet) dont il est lancé. */
  name: string
  dir?: string
  /** Adresse publique quand le port est exposé (Caddy). */
  url?: string
}

export interface InfraDetail {
  id: string
  name: string
  weevboss: boolean
  os: string
  cores: number
  /** Octets. */
  memTotal: number
  memUsed: number
  swapTotal: number
  swapUsed: number
  diskTotal: number
  diskUsed: number
  cpu: number
  load: [number, number, number]
  uptime: number
  /** Historique du jour, par tranches de 5 minutes (max de chaque tranche). */
  day: InfraPoint[]
  episodes: Episode[]
  servers: ServerProc[]
  /** Conseils tirés des mesures, dans la langue de l'utilisateur. */
  advice: string[]
}

export interface FsEntry {
  name: string
  dir: boolean
  size: number
  link?: boolean
}

export interface FsListing {
  path: string
  home: string
  entries: FsEntry[]
  error?: string
}

/** Une fenêtre de quota (5 h, semaine, semaine d'un modèle). */
export interface QuotaWindow {
  kind: 'session' | 'week' | 'model'
  /** Nom du modèle pour kind = model. */
  label?: string
  percent: number
  resetsAt: number | null
}

export interface QuotaInfo {
  ok: boolean
  plan?: string
  windows: QuotaWindow[]
  /** D'où viennent les chiffres (affiché nulle part, pour le débogage). */
  source: string
  at: number
  error?: string
}

export interface UsageInfo {
  claude: QuotaInfo
  codex: QuotaInfo
}

/** Consommation du jour, lue dans les transcripts (tokens) : la part de chacun, pas le quota lui-même. */
export interface UsageRow {
  id: string
  title: string
  projectId: string
  tool: 'claude' | 'codex'
  machine: string
  /** Tokens pondérés comme le prix (entrée 1, sortie 5, cache écrit 1,25, cache lu 0,1). */
  weight: number
  tokens: number
  last: number
}

export interface UsageToday {
  rows: UsageRow[]
}
