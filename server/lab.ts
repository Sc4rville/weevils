// The onboarding lab (docs/onboarding-lab.md): a dev tool for whoever builds weevils, off unless WEEVILS_LAB_DIR is set.
// On a blank instance whose code is a worktree of the builder's (scripts/lab.sh), they play the newcomer; with the green
// switch on, what they send is a remark about the onboarding instead: it lands in the lab folder, an agent on the host
// (scripts/lab/watch.mjs) changes the code, tests and builds it, and restarts this instance; weevils then plays the
// step again with the new code (Setup.restep) and the app reloads where it was. Files only, no network between them:
//   remarks/<id>.json   written here: what was said, what the screen showed, the pictures beside it (<id>-<n>.<ext>)
//   results/<id>.json   written by the host: working → built | failed, then undone; keep.json for « keep »
//   requests/<id>.json  written here: undo, keep, reset (the host does them)
import fs from 'node:fs'
import path from 'node:path'

import type { LabState, LabStatus } from '../shared/lab.ts'

export type { LabItem, LabState, LabStatus } from '../shared/lab.ts'

interface Result {
  status: 'working' | 'built' | 'failed' | 'undone'
  change?: string
  at: number
}

const readJson = <T>(f: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as T
  } catch {
    return null
  }
}

const writeJson = (f: string, v: unknown) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(v))
  fs.renameSync(tmp, f)
}

/** A built (or undone) change is played again once, with the new code; pure (tested): the keys not played yet. */
export function toReplay(results: { id: string; status: string }[], played: Set<string>): string[] {
  return results.filter((r) => r.status === 'built' || r.status === 'undone').map((r) => `${r.id}:${r.status}`).filter((k) => !played.has(k))
}

/** Pure (tested): a remark's status from its result and whether its change was played again. */
export function statusOf(r: Result | null, played: Set<string>, id: string): LabStatus {
  if (!r) return 'waiting'
  if (r.status === 'built') return played.has(`${id}:built`) ? 'done' : 'working'
  if (r.status === 'undone') return 'undone'
  return r.status
}

export class Lab {
  private playedFile: string
  private busy = false
  private dir: string
  /** Plays the onboarding's last step again with the code now running (Setup.restep). */
  private replay: () => Promise<unknown>

  constructor(dir: string, dataDir: string, replay: () => Promise<unknown>) {
    this.dir = dir
    this.replay = replay
    this.playedFile = path.join(dataDir, 'lab-played.json')
    // A blank instance (reset) has nothing to play again: what the host did before it is already in its code.
    if (!fs.existsSync(this.playedFile)) writeJson(this.playedFile, this.results().flatMap((r) => [`${r.id}:built`, `${r.id}:undone`]))
  }

  private played = () => new Set(readJson<string[]>(this.playedFile) ?? [])

  private results(): ({ id: string } & Result)[] {
    const d = path.join(this.dir, 'results')
    if (!fs.existsSync(d)) return []
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith('.json') && f !== 'keep.json' && f !== 'reset.json')
      .flatMap((f) => {
        const r = readJson<Result>(path.join(d, f))
        return r ? [{ id: f.slice(0, -5), ...r }] : []
      })
  }

  state(): LabState {
    const d = path.join(this.dir, 'remarks')
    const played = this.played()
    const items = fs.existsSync(d)
      ? fs
          .readdirSync(d)
          .filter((f) => f.endsWith('.json'))
          .flatMap((f) => {
            const r = readJson<{ id: string; at: number; text: string }>(path.join(d, f))
            if (!r) return []
            const res = readJson<Result>(path.join(this.dir, 'results', f))
            return [{ id: r.id, at: r.at, text: r.text, status: statusOf(res, played, r.id), ...(res?.change ? { change: res.change } : {}) }]
          })
          .sort((a, b) => a.at - b.at)
      : []
    const keep = readJson<LabState['keep']>(path.join(this.dir, 'results', 'keep.json')) ?? undefined
    const reset = readJson<{ at: number }>(path.join(this.dir, 'results', 'reset.json'))?.at
    return { on: true, items, ...(keep ? { keep } : {}), ...(reset ? { reset } : {}) }
  }

  /** A remark: its words, the last lines on screen, and its pictures (captures from the library, files sent with it). */
  remark(text: string, context: string[], pictures: { name: string; data: Buffer }[]): string {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const photos = pictures.map((p, i) => {
      const name = `${id}-${i + 1}${path.extname(p.name) || '.png'}`
      fs.mkdirSync(path.join(this.dir, 'remarks'), { recursive: true })
      fs.writeFileSync(path.join(this.dir, 'remarks', name), p.data)
      return name
    })
    writeJson(path.join(this.dir, 'remarks', `${id}.json`), { id, at: Date.now(), text, context: context.slice(-12), photos })
    return id
  }

  request(kind: 'undo' | 'keep' | 'reset', id?: string) {
    const rid = `${Date.now().toString(36)}-${kind}`
    writeJson(path.join(this.dir, 'requests', `${rid}.json`), { kind, ...(id ? { id } : {}), at: Date.now() })
  }

  /** Every few seconds: a change the host built (or undid) is played again once, then the app reloads. */
  async tick(): Promise<boolean> {
    if (this.busy) return false
    const played = this.played()
    const keys = toReplay(this.results(), played)
    if (!keys.length) return false
    this.busy = true
    try {
      await this.replay()
    } catch (e) {
      console.log(`[lab] replay: ${e instanceof Error ? e.message : e}`)
    } finally {
      writeJson(this.playedFile, [...played, ...keys])
      this.busy = false
    }
    return true
  }
}
