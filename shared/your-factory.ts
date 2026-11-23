// Your factory (docs/next-interaction.md, « Your factory »): what weevils works with, in the side bar of weevils next —
// the machines, the intelligence (subscriptions and API keys), the projects and the global Tempo. Read with
// GET /api/factory, changed with POST /api/factory/… (server/your-factory.ts). Percentages from 0 to 100.
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

export interface FactoryView {
  machines: FactoryMachine[]
  intelligence: FactoryIntel[]
  /** With two machines or more: tests and builds go to an idle machine when the one they start on is busy
   *  (server/heavy/jobs.ts). `away`: those running elsewhere now, by machine. */
  share?: { on: boolean; away: { name: string; n: number }[] }
}

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
