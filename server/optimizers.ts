// The h24 that never sleeps: from the memory and the real projects, weevils proposes background tasks (« optimizers »:
// harden a repo's tests, watch a topic the user cares about, prepare content, explore an idea they mentioned). Each one
// is accepted or refused with one tap. Accepted ones run in an agent session when the machine is free (no agent
// working, load and memory below the `heavy` thresholds), one at a time, never destructive, paid or published
// without the user's go.
//
// SKELETON (foundation commit): the real logic lands in the « h24 optimizers » step.

import type http from 'node:http'
import type { Optimizer } from '../shared/api.ts'
import type { Weevils } from './core.ts'
import type { Memory } from './memory.ts'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>

export class Optimizers {
  readonly w: Weevils
  readonly memory: Memory

  constructor(w: Weevils, memory: Memory) {
    this.w = w
    this.memory = memory
  }

  /** Proposal rounds and the runner loop. */
  start() {}

  /** For the snapshot: proposed, queued, running and recently finished (never the refused ones). */
  list(): Optimizer[] {
    return []
  }

  accept(_id: string) {}
  refuse(_id: string) {}
}

/** POST /api/optimizers/:id/accept · POST /api/optimizers/:id/refuse */
export function optimizerRoutes(o: Optimizers, json: Json, _readBody: ReadBody): [string, RegExp, Handler][] {
  return [
    ['POST', /^\/api\/optimizers\/([\w-]+)\/accept$/, (_req, res, _u, [id]) => {
      o.accept(id)
      json(res, 200, { ok: true })
    }],
    ['POST', /^\/api\/optimizers\/([\w-]+)\/refuse$/, (_req, res, _u, [id]) => {
      o.refuse(id)
      json(res, 200, { ok: true })
    }],
  ]
}
