// Moves of a conversation, wired into weevilsd (docs/spec/07-vault.md, step 4; server/weevbook/proposals.ts): the
// proposals weevboss says in one line, the watch of the vault's leases on the machine that serves the app, and the
// routes `weevils weevbook agree | move | machines` call. Nothing here moves a conversation by itself.

import type http from 'node:http'
import path from 'node:path'
import { accounts } from './claude-accounts.ts'
import type { Weevils } from './core.ts'
import { tr } from './i18n.ts'
import M from './i18n/weevbook-move.ts'
import { claudeAccountOf } from './weevbook/engines.ts'
import type { HubSync } from './weevbook/hub.ts'
import type { Provider } from './weevbook/journal.ts'
import { askMove, clearMoves, moveThread, noteResult, openProposals, settle, startVaultWatch, type MachineLine, type MoveHost, type MoveRequest, type MoveResult, type Proposal } from './weevbook/proposals.ts'
import { resumeThread, type Launch, type ResumeResult } from './weevbook/resume.ts'
import { Sessions, accountOf } from './weevbook/sync.ts'
import { vaultSource } from './weevbook/vault-raw.ts'
import type { VaultOptions } from './weevbook/vault.ts'

type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void

export interface MovesOptions {
  w: Weevils
  machine: { id: string; name: string }
  dataDir: string
  home: string
  claudeDir: string
  codexDir: string
  roots: string[]
  projectsDir: string
  /** The hub and its sync, when this machine has one (a move then follows 03's own rules). */
  hub?: { url: string; here: boolean }
  sync?: HubSync
  /** This machine's vault now (null: none). */
  vault: () => VaultOptions | null
  /** This machine serves the app with a vault and no hub: it watches the vault's leases and proposes. */
  watch: boolean
  /** The dispatcher looks at a thread again (an agreed move of its own). */
  poke?: (thread: string) => void
  log?: (line: string) => void
}

/** What `agree` answers, per proposal. */
export interface Agreed {
  id: string
  title: string
  ok: boolean
  /** `moved`, `later` (the dispatcher takes it from here), `back` (its machine came back: withdrawn), or why not. */
  what: string
  machine?: string
}

/** The one line weevboss says for new proposals (those of one look, of one machine). */
export function proposalLine(made: readonly Proposal[], minutes: number, here: string, account = ''): string {
  const t = tr(M)
  const p = made[0]
  if (p.kind === 'silent') return made.length === 1 ? t.silentOne(p.from, minutes, p.title, here) : t.silentMany(p.from, minutes, made.length, here)
  if (p.kind === 'account') return t.account(p.title, account)
  if (p.kind === 'machine') return t.machine(p.title, p.to)
  return t.provider(p.title, p.to)
}

export function startMoves(o: MovesOptions) {
  const { w } = o
  const file = path.join(o.dataDir, 'weevbook-proposals.json')
  const sessionsFile = path.join(o.dataDir, 'weevbook-sessions.jsonl')
  const say = (made: Proposal[], minutes: number) => {
    if (!made.length) return
    const line = proposalLine(made, minutes, o.machine.name, made[0].kind === 'account' ? accountLabel(made[0].to) : '')
    o.log?.(`[moves] proposed ${made.map((p) => p.id).join(', ')}: ${made[0].reason}`)
    w.setup?.say(line)
    if (w.push.enabled) void w.push.send({ title: 'weevboss', body: line.replace(/\*\*/g, '').slice(0, 220), url: '/#boss', tag: `move-${made[0].id}`, category: 'question' })
  }

  /** The e-mail of a Claude account of this machine, from the six characters an engine id carries ('' when unknown). */
  function accountLabel(hash: string): string {
    const a = accounts()
    const f = a?.folders().find((x) => claudeAccountOf(x.dir, o.home) === hash)
    return (f && a!.view()?.find((v) => v.id === f.id)?.label) || ''
  }

  const machines = (): MachineLine[] => [
    { id: o.machine.id, name: o.machine.name, here: true, online: true },
    ...w.remotes.flatMap((r) => (r.snap?.machines[0] ? [{ id: r.snap.machines[0].id, name: r.snap.machines[0].name || r.snap.machines[0].id, here: false, online: r.online }] : [])),
  ]
  const remoteOf = (machine: string) => w.remotes.find((r) => r.snap?.machines[0]?.id === machine)

  /** The thread a provider session of this machine belongs to (its id, or the start of it). */
  const threadOf = async (session: string): Promise<string | null> => {
    if (!session) return null
    const s = new Sessions(sessionsFile)
    await s.load()
    const hit = s.all().filter((r) => r.key.slice(r.key.indexOf(':') + 1).startsWith(session))
    return hit.length && hit.every((r) => r.thread === hit[0].thread) ? hit[0].thread : null
  }

  const launch = async (l: Launch) => {
    try {
      await w.send(l.session, l.text)
    } catch (e) {
      // A session file this machine has not listed yet (rebuilt from the vault a moment ago): started by its id.
      if ((e as { status?: number }).status !== 404) throw e
      await w.resumeIn(l.provider, l.cwd, l.session, l.text)
    }
  }

  const resume = async (r: { thread: string; engine?: string; account?: string; force?: boolean }): Promise<ResumeResult> => {
    const v = o.vault()
    // The Claude account named, made the active one here before the engine starts.
    let account: ((p: Provider) => string) | undefined
    if (r.account) {
      const a = accounts()
      const want = r.account.toLowerCase()
      const view = a?.view()?.find((x) => x.id.toLowerCase() === want || x.label.toLowerCase() === want || x.label.toLowerCase().startsWith(`${want}@`) || String(x.n) === want)
      const dir = view ? a!.folders().find((f) => f.id === view.id) : undefined
      if (!view || !dir) return { ok: false, why: 'hold', detail: tr(M).noAccount(r.account) }
      a!.use(view.id)
      account = (p) => (p === 'claude' ? claudeAccountOf(dir.dir, o.home) : accountOf(p, o.home, path.dirname(o.codexDir)))
    }
    const provider = r.engine === 'claude' || r.engine === 'codex' ? r.engine : undefined
    const out = await resumeThread({
      thread: r.thread, dir: path.join(o.dataDir, 'weevbook'), dataDir: o.dataDir, sessions: sessionsFile, machine: o.machine.id, home: o.home, claudeDir: o.claudeDir, codexDir: o.codexDir,
      roots: o.roots, projectsDir: o.projectsDir, ...(o.hub ? { hub: o.hub } : {}), ...(o.sync ? { sync: o.sync } : {}), ...(v ? { vault: vaultSource(v) } : {}), ...(account ? { account } : {}), ...(provider ? { provider } : {}),
      force: !!r.force, launch, log: o.log,
    })
    return !out.ok && out.why === 'other-provider' ? { ...out, detail: tr(M).otherProvider(out.detail) } : out
  }

  const host: MoveHost = {
    machines,
    threadOf,
    async askThread(session) {
      for (const r of w.remotes) {
        if (!r.online) continue
        const t = await r.call<{ thread: string | null }>('GET', `/api/weevbook/thread?session=${encodeURIComponent(session)}`).catch(() => null)
        if (t?.thread) return t.thread
      }
      return null
    },
    resume,
    async forward(machine, r) {
      const remote = remoteOf(machine)
      if (!remote) return { ok: false, why: 'unreachable', detail: `${machine} is not a machine of this install` } // i18n-ignore: for weevboss, with the names of `machines`
      return remote.call<MoveResult>('POST', '/api/weevbook/move', r).catch((e: Error): MoveResult => ({ ok: false, why: 'unreachable', detail: e.message }))
    },
  }
  const move = (r: MoveRequest) => moveThread(host, r)

  /** The person said yes: the open proposals (`id`: that one) are run. A silent machine that came back keeps its work. */
  const agree = async (id?: string): Promise<Agreed[]> => {
    const out: Agreed[] = []
    for (const p of openProposals(file).filter((x) => id === undefined || x.id === id)) {
      if (p.kind !== 'silent') {
        settle(file, p.id, 'agreed', Date.now())
        o.poke?.(p.thread)
        out.push({ id: p.id, title: p.title, ok: true, what: 'later' })
        continue
      }
      const r = await move({ thread: p.thread, to: p.to })
      if (!r.ok && r.why === 'held') {
        settle(file, p.id, 'withdrawn', Date.now(), r.detail)
        out.push({ id: p.id, title: p.title, ok: false, what: 'back', machine: r.holder ?? p.from })
        continue
      }
      settle(file, p.id, 'agreed', Date.now())
      noteResult(file, p.id, r.ok ? `continues on ${r.machine}` : `${r.why}: ${r.detail}`) // i18n-ignore: kept with the proposal, for weevboss
      out.push(r.ok ? { id: p.id, title: p.title, ok: true, what: 'moved', machine: r.machine } : { id: p.id, title: p.title, ok: false, what: `${r.why}: ${r.detail}` })
      o.log?.(`[moves] ${p.id} agreed: ${r.ok ? `${p.thread} continues on ${r.machine}` : `${r.why}: ${r.detail}`}`)
    }
    return out
  }

  const watch = o.watch ? startVaultWatch({ vault: o.vault, file, say, log: o.log, refresh: (v, thread) => vaultSource(v).refresh(thread) }) : null

  const routes = (json: Json, readBody: ReadBody, isLocal: (req: http.IncomingMessage) => boolean): [string, RegExp, Handler][] => {
    const local = (h: Handler): Handler => (req, res, url, params) => (isLocal(req) ? h(req, res, url, params) : json(res, 403, { error: 'forbidden' })) // i18n-ignore: machine to machine
    return [
      ['GET', /^\/api\/weevbook\/machines$/, local((_req, res) => json(res, 200, { machines: machines() }))],
      ['GET', /^\/api\/weevbook\/thread$/, local(async (_req, res, url) => json(res, 200, { thread: await threadOf(url.searchParams.get('session') ?? '') }))],
      ['POST', /^\/api\/weevbook\/move$/, local(async (req, res) => {
        const b = await readBody(req)
        json(res, 200, await move({ thread: String(b?.thread ?? ''), ...(typeof b?.to === 'string' ? { to: b.to } : {}), ...(typeof b?.engine === 'string' ? { engine: b.engine } : {}), ...(typeof b?.account === 'string' ? { account: b.account } : {}), force: b?.force === true }))
      })],
      ['POST', /^\/api\/weevbook\/agree$/, local(async (req, res) => {
        const b = await readBody(req)
        json(res, 200, { agreed: await agree(typeof b?.id === 'string' ? b.id : undefined) })
      })],
    ]
  }

  return {
    file,
    routes,
    move,
    agree,
    /** For the dispatcher (threads.ts): a move of its table, proposed once and held until agreed. */
    moves: {
      ask: (m: Parameters<typeof askMove>[1]) => askMove(file, m, Date.now(), (p) => say([p], 0)),
      clear: (thread: string) => clearMoves(file, thread, Date.now()),
    },
    stop: () => watch?.stop(),
  }
}
