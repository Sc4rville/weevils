// Your factory (docs/next-interaction.md, « Your factory »): what weevils works with, in the side bar of weevils next —
// the machines, the intelligence (subscriptions and API keys), the projects and the global Tempo. Read with
// GET /api/factory, changed with POST /api/factory/… (server/your-factory.ts). Percentages from 0 to 100.
import type { MachineAway } from './api.ts'
import type { Level } from './infra.ts'

export type MachineKind = 'pc' | 'server'

export interface FactoryMachine {
  id: string
  name: string
  /** A computer of yours or a server at a host; null: not known (an older weevilsd on that machine). */
  kind: MachineKind | null
  online: boolean
  /** Turned off here: nothing new starts on it. */
  off: boolean
  /** weevboss runs on it. */
  here: boolean
  /** Claude Code there, from the snapshot (absent: not known). */
  claude?: { installed: boolean; logged: boolean }
  /** Its health in one figure: the fullest of processor, memory and disk (null: not measured). */
  load: number | null
  level: Level
  cpu?: number
  mem?: number
  disk?: number
  /** The host's own dashboard for this server, when the host is known. */
  panel?: string
  /** The host (Hostinger, Hetzner…), for a server. */
  provider?: string
  /** Its own conversation, once started. */
  talk?: string
  /** Why it does not answer, and since when (only while it does not). */
  away?: MachineAway
}

/** Whose logo a line wears. */
export type Brand = 'claude' | 'openai' | 'gemini' | 'mistral' | 'xai' | 'openrouter'

export interface FactoryIntel {
  /** « claude », « codex », « account:<id> », or « key:<NAME> ». */
  id: string
  kind: 'subscription' | 'key'
  brand: Brand
  name: string
  plan?: string
  /** What is left of its fullest window, read from the provider's own meter (null: no meter, as for a key). */
  left: number | null
  resetsAt: number | null
  off: boolean
  /** Whether turning it off is possible here (Claude carries weevboss itself: never). */
  toggle: boolean
}

/** On demand: compute paid by the hour (a GPU for a render, a model, a long job), reached with the provider's API key. */
export type OnDemandId = 'runpod' | 'vast'

export interface FactoryOnDemand {
  id: OnDemandId
  name: string
  /** The key's name in weevils' config (typed only in the masked field). */
  key: string
  /** A key is there. */
  connected: boolean
  /** Its place in the fallback order (1: tried first, the next when it has no credit or no free GPU); null: off, or
   *  no key. */
  rank: number | null
  /** The provider refused the key. */
  refused?: boolean
  /** Credit left, in US dollars (null: not known). */
  credit: number | null
  /** What runs there costs this much per hour now, in US dollars (0: nothing runs; null: not known). */
  perHour: number | null
  /** The provider's own console. */
  console: string
}

export interface FactoryView {
  machines: FactoryMachine[]
  intelligence: FactoryIntel[]
  /** With two machines or more: tests and builds go to an idle machine when the one they start on is busy
   *  (server/heavy/jobs.ts). `away`: those running elsewhere now, by machine. */
  share?: { on: boolean; away: { name: string; n: number }[] }
  /** Missing from an older weevilsd. */
  onDemand?: FactoryOnDemand[]
}

/** The on-demand providers weevils reads (credit, spend per hour), by the key name its setup stores them under. */
export const ON_DEMAND: { id: OnDemandId; key: string; name: string; console: string }[] = [
  { id: 'runpod', key: 'RUNPOD_API_KEY', name: 'RunPod', console: 'https://console.runpod.io/' }, // i18n-ignore: a product's name
  { id: 'vast', key: 'VAST_API_KEY', name: 'Vast.ai', console: 'https://cloud.vast.ai/' }, // i18n-ignore: a product's name
]
/** The setting agents read: the providers switched on, comma-separated, first tried first (« none »: all off). */
export const ON_DEMAND_VAR = 'WEEVILS_ON_DEMAND'

/** The API keys that are intelligence (a model provider), by the name weevils' setup stores them under
 *  (~/.config/weevils/env). Read by the server; the app offers the missing ones under Intelligence's « + ». */
export const KEYS: { name: string; brand: Brand; label: string }[] = [
  { name: 'ANTHROPIC_API_KEY', brand: 'claude', label: 'Anthropic API' },
  { name: 'OPENAI_API_KEY', brand: 'openai', label: 'OpenAI API' },
  { name: 'GEMINI_API_KEY', brand: 'gemini', label: 'Gemini API' }, // i18n-ignore: a product's name
  { name: 'MISTRAL_API_KEY', brand: 'mistral', label: 'Mistral API' }, // i18n-ignore: a product's name
  { name: 'XAI_API_KEY', brand: 'xai', label: 'xAI API' }, // i18n-ignore: a product's name
  { name: 'OPENROUTER_API_KEY', brand: 'openrouter', label: 'OpenRouter' },
]
