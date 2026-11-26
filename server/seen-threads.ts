// The last thread read from another machine, kept here (2026-11-26): when that machine goes offline (a laptop
// closed, a PC asleep), its conversations still open on their history, never on an empty page. One small file per
// conversation under the data folder, read back after a restart; the weevbook, when it has more, wins (core.ts).
import fs from 'node:fs'
import path from 'node:path'
import type { SessionDetail } from '../shared/api.ts'

const SAFE = /^[\w-]{1,80}$/

export class SeenThreads {
  private mem = new Map<string, SessionDetail>()
  constructor(private dir: string, private max = 300) {}

  /** Keeps a thread that came back with something in it (an empty answer never erases what was seen). */
  remember(d: SessionDetail | undefined | null) {
    const id = d?.session?.id
    if (!d || !id || !SAFE.test(id) || !d.messages?.length) return
    const had = this.mem.get(id)
    this.mem.delete(id)
    this.mem.set(id, d)
    while (this.mem.size > this.max) this.mem.delete(this.mem.keys().next().value!)
    if (had && had.messages.length === d.messages.length && had.messages.at(-1)?.id === d.messages.at(-1)?.id) return
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      const tmp = path.join(this.dir, `.${id}.tmp`)
      fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 })
      fs.renameSync(tmp, path.join(this.dir, `${id}.json`))
    } catch {
      /* a full disk: kept in memory only */
    }
  }

  /** The last thread seen for this conversation, or null. */
  recall(id: string): SessionDetail | null {
    if (!SAFE.test(id)) return null
    const hit = this.mem.get(id)
    if (hit) return hit
    try {
      const d = JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8')) as SessionDetail
      if (d?.messages?.length) this.mem.set(id, d)
      return d?.messages?.length ? d : null
    } catch {
      return null
    }
  }
}
