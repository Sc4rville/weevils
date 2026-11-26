// Claude Code's sign-in on another machine of yours, driven from weevboss's thread on the main machine: no terminal there.
//
// On that machine (a secondary one), two machine-to-machine routes, reached only by the main machine through its tunnel
// with this machine's local token (server/index.ts, like /api/machine/ask):
//   POST /api/machine/claude/login { fresh?, install? } → { installed, logged, url?, why? }
//     starts the real sign-in (server/claude-login.ts, the same one weevboss's own flow drives) or gives back the one
//     that waits; installs Claude Code first when asked and it is missing (the official installer, as install.sh does).
//   POST /api/machine/claude/code { code } → { ok: true } | { ok: false, why }
//     hands it the code the official page gave, then waits until Claude Code is signed in there.
//
// On the main machine, Setup (server/setup.ts) keeps which machine waits for a code (waitingFor below): the code the person
// pastes in weevboss's chat goes to that machine, never to the model.
import type { Result } from './claude-login.ts'
import { LOGIN_TTL } from './claude-login.ts'

/** Claude Code on this machine, as weevils can drive it. */
export interface Here {
  installed: () => boolean
  logged: () => boolean
  /** The official installer, when Claude Code is missing (Setup.install). */
  install: () => Promise<{ ok: boolean; why: string }>
  /** Starts the sign-in, or gives back the one that waits: the official page's address, '' when the CLI gave none. */
  start: (fresh: boolean) => Promise<string>
  /** Why the CLI gave no address (its last line). */
  why: () => string
  submit: (code: string) => Promise<Result>
}

export interface LoginAnswer {
  installed: boolean
  logged: boolean
  url?: string
  why?: string
}

export type CodeAnswer = Result

/** What that machine answers the main one. */
export async function answer(what: 'login' | 'code', body: unknown, here: Here): Promise<{ status: number; body: LoginAnswer | CodeAnswer | { error: string } }> {
  const b = (body && typeof body === 'object' ? body : {}) as { fresh?: unknown; install?: unknown; code?: unknown }
  if (what === 'code') {
    const code = typeof b.code === 'string' ? b.code.replace(/\s+/g, '') : ''
    if (!code || code.length > 512) return { status: 400, body: { error: 'bad request' } } // i18n-ignore: machine-to-machine answer
    if (here.logged()) return { status: 200, body: { ok: true } }
    return { status: 200, body: await here.submit(code) }
  }
  if (!here.installed()) {
    if (b.install !== true) return { status: 200, body: { installed: false, logged: false } }
    const r = await here.install()
    if (!r.ok || !here.installed()) return { status: 200, body: { installed: false, logged: false, why: r.why } }
  }
  if (here.logged()) return { status: 200, body: { installed: true, logged: true } }
  const url = await here.start(b.fresh === true)
  return { status: 200, body: url ? { installed: true, logged: false, url } : { installed: true, logged: false, why: here.why() } }
}

/** Machines whose Claude sign-in waits for its code (started from the main machine), by when it started. */
export type Waiting = Record<string, number>

/** The machine a pasted code is for: the latest sign-in started that is still usable. */
export function waitingFor(w: Waiting | undefined, now = Date.now()): string | null {
  let best: [string, number] | null = null
  for (const [id, at] of Object.entries(w ?? {})) if (now - at < LOGIN_TTL && (!best || at > best[1])) best = [id, at]
  return best?.[0] ?? null
}

/** The same, without the sign-ins too old to take a code. */
export function fresh(w: Waiting | undefined, now = Date.now()): Waiting {
  return Object.fromEntries(Object.entries(w ?? {}).filter(([, at]) => now - at < LOGIN_TTL))
}

/** A machine id as a link carries it (/#do=claude.<id>). */
export const MACHINE_ID = /^[A-Za-z0-9_-]{1,64}$/
