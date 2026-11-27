// A key or a token an agent asks for: is it already on this machine, and does the provider accept it?
// (The rule and the order: shared/key-sources.ts. Never a value in a log, a thread or an error.)
import fs from 'node:fs'
import path from 'node:path'
import { keyPrefix } from '../shared/key-sources.ts'

const read = (f: string): string => {
  try {
    return fs.readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}

/** Where a secret was found, in words for the thread (a catalog key: server/i18n/setup.ts `keyFrom_*`). */
export type KeyPlace = 'shell' | 'tool'
export interface FoundKey {
  value: string
  from: KeyPlace
}

/** The files a shell reads at sign-in, where people keep `export OPENAI_API_KEY=…`. */
const SHELL_FILES = ['.zshenv', '.zprofile', '.zshrc', '.bash_profile', '.bashrc', '.profile', path.join('.config', 'fish', 'config.fish')]

/** A plain value written in a shell file: `export NAME=value`, `NAME="value"`, fish's `set -gx NAME value`. Never one
 *  that is computed (`$(…)`, `$OTHER`): reading it would mean running the file. */
export function shellValue(text: string, name: string): string {
  let out = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) continue
    const m = new RegExp(`^(?:export\\s+)?${name}=(.*)$`).exec(line) ?? new RegExp(`^set\\s+(?:-\\w+\\s+)*${name}\\s+(.*)$`).exec(line)
    if (!m) continue
    let v = m[1].trim().replace(/\s+#.*$/, '').replace(/;$/, '').trim()
    const q = /^(["'])(.*)\1$/.exec(v)
    if (q) v = q[2]
    if (!v || /[$`\s]/.test(v)) continue
    out = v
  }
  return out
}

/** What a provider's own tool keeps on this machine after its sign-in, by the name's prefix. */
const TOOL_STORES: Record<string, (home: string, env: NodeJS.ProcessEnv) => string> = {
  // npm's web sign-in writes its token there (« weevils setup npm »).
  NPM: (home) => /^\/\/registry\.npmjs\.org\/:_authToken=(\S+)$/m.exec(read(path.join(home, '.npmrc')))?.[1] ?? '',
  HF: (home, env) => read(path.join(env.HF_HOME || path.join(home, '.cache', 'huggingface'), 'token')).trim(),
  HUGGINGFACE: (home, env) => TOOL_STORES.HF(home, env),
  RUNPOD: (home) => /^\s*apikey\s*=\s*["']?([^"'\s]+)["']?\s*$/im.exec(read(path.join(home, '.runpod', 'config.toml')))?.[1] ?? '',
  VAST: (home) => read(path.join(home, '.config', 'vastai', 'vast_api_key')).trim() || read(path.join(home, '.vast_api_key')).trim(),
  // Codex signed in with an API key (not a ChatGPT subscription) keeps it in its auth file.
  OPENAI: (home, env) => {
    try {
      const j = JSON.parse(read(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'auth.json')) || '{}') as { OPENAI_API_KEY?: unknown }
      return typeof j.OPENAI_API_KEY === 'string' ? j.OPENAI_API_KEY : ''
    } catch {
      return ''
    }
  },
  VERCEL: (home) => {
    try {
      const j = JSON.parse(read(path.join(home, '.local', 'share', 'com.vercel.cli', 'auth.json')) || '{}') as { token?: unknown }
      return typeof j.token === 'string' ? j.token : ''
    } catch {
      return ''
    }
  },
}

const sane = (v: string) => (v.length >= 8 && v.length <= 4096 && !/[\r\n]/.test(v) ? v : '')

/** This secret, if the machine already has it: under its own name in the service's environment or the shell's files,
 *  or kept by the provider's tool. Pure reads, nothing is run. */
export function findKey(name: string, home: string, env: NodeJS.ProcessEnv = process.env): FoundKey | null {
  const inEnv = sane((env[name] ?? '').trim())
  if (inEnv) return { value: inEnv, from: 'shell' }
  for (const f of SHELL_FILES) {
    const v = sane(shellValue(read(path.join(home, f)), name))
    if (v) return { value: v, from: 'shell' }
  }
  const tool = sane(TOOL_STORES[keyPrefix(name)]?.(home, env) ?? '')
  return tool ? { value: tool, from: 'tool' } : null
}

type Probe = { url: string; headers: (v: string) => Record<string, string>; bad?: number[] }
const bearer = (v: string) => ({ authorization: `Bearer ${v}` })
/** One cheap read per provider that says whether a key is accepted. Only a clear refusal counts (401, or what the
 *  provider answers for a bad key): a key limited to other rights, a provider that is down, are not a « no ». */
const PROBES: Record<string, Probe> = {
  OPENAI: { url: 'https://api.openai.com/v1/models', headers: bearer },
  ANTHROPIC: { url: 'https://api.anthropic.com/v1/models?limit=1', headers: (v) => ({ 'x-api-key': v, 'anthropic-version': '2023-06-01' }) },
  GEMINI: { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: (v) => ({ 'x-goog-api-key': v }), bad: [400, 401, 403] },
  MISTRAL: { url: 'https://api.mistral.ai/v1/models', headers: bearer },
  OPENROUTER: { url: 'https://openrouter.ai/api/v1/key', headers: bearer },
  GROQ: { url: 'https://api.groq.com/openai/v1/models', headers: bearer },
  DEEPSEEK: { url: 'https://api.deepseek.com/models', headers: bearer },
  CARTESIA: { url: 'https://api.cartesia.ai/voices?limit=1', headers: (v) => ({ 'X-API-Key': v, 'Cartesia-Version': '2025-04-16' }) },
  REPLICATE: { url: 'https://api.replicate.com/v1/account', headers: bearer },
  HF: { url: 'https://huggingface.co/api/whoami-v2', headers: bearer },
  HUGGINGFACE: { url: 'https://huggingface.co/api/whoami-v2', headers: bearer },
  GITHUB: { url: 'https://api.github.com/user', headers: (v) => ({ ...bearer(v), 'user-agent': 'weevils' }) },
  GH: { url: 'https://api.github.com/user', headers: (v) => ({ ...bearer(v), 'user-agent': 'weevils' }) },
  NPM: { url: 'https://registry.npmjs.org/-/whoami', headers: bearer },
  STRIPE: { url: 'https://api.stripe.com/v1/balance', headers: bearer },
}

/** 'ok': the provider accepts it · 'refused': it says no · 'unknown': no way to ask (no check for it, no network). */
export async function checkKey(name: string, value: string, fetcher: typeof fetch = fetch): Promise<'ok' | 'refused' | 'unknown'> {
  const p = PROBES[keyPrefix(name)]
  if (!p) return 'unknown'
  try {
    const res = await fetcher(p.url, { headers: p.headers(value), signal: AbortSignal.timeout(8000) })
    if (res.ok) return 'ok'
    return (p.bad ?? [401]).includes(res.status) ? 'refused' : 'unknown'
  } catch {
    return 'unknown'
  }
}
