// `weevils weevbook proposals | agree | decline | move | machines` (docs/spec/07-vault.md, step 4), run from cli.ts.
// weevboss runs them: a move that weevils would have made by itself waits as a proposal for the person's yes, and a
// direct order moves a conversation at once.
//
//   proposals [--json]      the moves that wait for an answer (what, from where to where, why)
//   agree [<id>]            the person said yes: the open proposals (or that one) are run by the local weevilsd
//   decline [<id>]          the person said no: nothing moves, and the same cause is never asked again
//   move <session|thread> --to <machine> [--engine claude|codex] [--account <name>] [--force]
//                           the person's order: the conversation continues on that machine (the local weevilsd does
//                           it, or asks that machine's). --force: even from a machine that is still at work on it
//   machines [--json]       the machines of this install, by name, as `--to` takes them

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, PORT } from '../config.ts'
import { tr } from '../i18n.ts'
import M from '../i18n/weevbook-move.ts'
import type { Agreed } from '../moves-app.ts'
import { openProposals, settle, type MachineLine, type MoveResult, type Proposal } from './proposals.ts'

/** One call to this machine's weevilsd, signed with its local token. */
async function local<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const token = /([0-9a-f]{32,128})\s*$/i.exec(fs.readFileSync(path.join(DATA_DIR, 'local-token'), 'utf8'))?.[1] ?? ''
  const r = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-weevils-local': token },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10 * 60_000),
  })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
  return (await r.json()) as T
}

export async function moveMain(args: string[], out: (line: string) => void): Promise<number> {
  const t = tr(M)
  const opt = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const file = path.join(opt('--data-dir') ?? DATA_DIR, 'weevbook-proposals.json')
  const id = args[1] && !args[1].startsWith('-') ? args[1] : undefined
  const line = (p: Proposal) => t.line(p.id, p.state, p.title, p.from, p.to, p.reason)
  try {
    switch (args[0]) {
      case 'proposals': {
        const open = openProposals(file)
        if (args.includes('--json')) out(JSON.stringify({ open }))
        else if (!open.length) out(t.none)
        else for (const p of open) out(line(p))
        return 0
      }
      case 'decline': {
        const done = settle(file, id, 'declined', Date.now())
        if (!done.length) out(id ? t.noSuch(id) : t.none)
        for (const p of done) out(t.declined(p.id, p.title))
        return done.length || !id ? 0 : 1
      }
      case 'agree': {
        if (!openProposals(file).some((p) => !id || p.id === id)) {
          out(id ? t.noSuch(id) : t.none)
          return id ? 1 : 0
        }
        const { agreed } = await local<{ agreed: Agreed[] }>('POST', '/api/weevbook/agree', id ? { id } : {})
        for (const a of agreed) out(a.what === 'moved' ? t.agreed(a.id, a.title, a.machine ?? '') : a.what === 'later' ? t.agreedLater(a.id, a.title) : a.what === 'back' ? t.back(a.id, a.title, a.machine ?? '') : t.agreeFailed(a.id, a.title, a.what))
        return agreed.every((a) => a.ok || a.what === 'back') ? 0 : 1
      }
      case 'move': {
        const to = opt('--to')
        if (!id || !to) {
          out(t.usage)
          return 2
        }
        const r = await local<MoveResult>('POST', '/api/weevbook/move', { thread: id, to, ...(opt('--engine') ? { engine: opt('--engine') } : {}), ...(opt('--account') ? { account: opt('--account') } : {}), force: args.includes('--force') })
        if (!r.ok) {
          out(r.why === 'held' && r.holder && !args.includes('--force') ? t.atWork(r.holder, r.detail) : t.refused(r.why, r.detail))
          return 1
        }
        if (r.stole) out(t.stole)
        out(t.moved(r.thread, r.machine, r.turn))
        return 0
      }
      case 'machines': {
        const { machines } = await local<{ machines: MachineLine[] }>('GET', '/api/weevbook/machines')
        if (args.includes('--json')) out(JSON.stringify({ machines }))
        else for (const m of machines) out(t.machineLine(m.name, m.id, m.here, m.online))
        return 0
      }
      default:
        out(t.usage)
        return 2
    }
  } catch (e) {
    out(t.noServer((e as Error).message))
    return 1
  }
}
