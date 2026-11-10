// Flying weevils: now and then a small weevil drifts across the app carrying a short question about the user's goals,
// wishes and projects. Caught (tapped), it opens a short exchange; each answer feeds the memory (server/memory.ts).
// Questions are written by the model from the memory and the real projects: no fixed list, never twice the same.
//
// SKELETON (foundation commit): the real logic lands in the « flying weevils » step.

import type http from 'node:http'
import type { WeevilQuestion, WeevilReply } from '../shared/api.ts'
import type { Weevils } from './core.ts'
import type { Memory } from './memory.ts'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>

export class Flyers {
  readonly w: Weevils
  readonly memory: Memory

  constructor(w: Weevils, memory: Memory) {
    this.w = w
    this.memory = memory
  }

  /** A question ready to fly (generated ahead of time), or null when none is ready (no model, still writing…). */
  async next(): Promise<WeevilQuestion | null> {
    return null
  }

  /** The weevil flew by without being caught: it will come back later with the same question. */
  missed(id: string) {
    this.memory.markAsked(id, 'shown')
  }

  /** What the user answered (typed or spoken), with the exchange so far: a short reply, and what was remembered. */
  async answer(_id: string, _text: string, _history: { role: 'weevil' | 'user'; text: string }[] = []): Promise<WeevilReply> {
    return { reply: '', learned: [], done: true }
  }
}

/** GET /api/weevil → { question } · POST /api/weevil/:id/missed · POST /api/weevil/:id/answer { text, history } → WeevilReply */
export function weevilRoutes(f: Flyers, json: Json, readBody: ReadBody): [string, RegExp, Handler][] {
  return [
    ['GET', /^\/api\/weevil$/, async (_req, res) => json(res, 200, { question: await f.next() })],
    ['POST', /^\/api\/weevil\/([\w-]+)\/missed$/, (_req, res, _u, [id]) => {
      f.missed(id)
      json(res, 200, { ok: true })
    }],
    ['POST', /^\/api\/weevil\/([\w-]+)\/answer$/, async (req, res, _u, [id]) => {
      const body = await readBody(req)
      const history = Array.isArray(body.history) ? body.history.slice(-8) : []
      json(res, 200, await f.answer(id, String(body.text ?? ''), history))
    }],
  ]
}
