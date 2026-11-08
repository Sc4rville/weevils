import { describe, expect, it } from 'vitest'
import { createInitialState, globalStats, h24Stats, projectStats, reducer, routeCommand, type Action } from './store'
import type { State } from './types'

const NOW = 1_800_000_000_000
const run = (state: State, ...actions: Action[]) => actions.reduce(reducer, state)

describe('agent principal', () => {
  it('« reprends le CRM » va dans la session crm qui attend, une seule fois', () => {
    const s0 = createInitialState(NOW)
    const route = routeCommand(s0, 'Reprends le CRM')
    expect(route).toEqual({ kind: 'forward', sessionId: 'crm-claude-01' })
    const send: Action = { type: 'main/send', msgId: 'x1', text: 'reprends le crm', route, at: NOW }
    const s1 = run(s0, send, send)
    const target = s1.sessions.find((s) => s.id === 'crm-claude-01')!
    expect(target.messages.filter((m) => m.via === 'weevils')).toHaveLength(1)
    // Transmettre ne résout pas la demande d'intervention.
    expect(target.status).toBe('needs_user')
    expect(projectStats(s1, 'crm').pending).toBe(1)
  })

  it('« ouvre claude lws » ouvre sans écrire dans la session', () => {
    const s0 = createInitialState(NOW)
    expect(routeCommand(s0, 'ouvre claude lws')).toEqual({ kind: 'open', sessionId: 'lws-claude-01' })
  })

  it('une commande inconnue demande la destination au lieu de prétendre l’exécuter', () => {
    const s0 = createInitialState(NOW)
    const route = routeCommand(s0, 'fais un truc génial')
    expect(route.kind).toBe('unknown')
    const s1 = run(s0, { type: 'main/send', msgId: 'u1', text: 'fais un truc génial', route, at: NOW })
    const ask = s1.main.find((m) => m.ask)!
    const choose: Action = { type: 'main/choose', mainMsgId: ask.id, sessionId: 'lws-codex-01', at: NOW }
    const s2 = run(s1, choose, choose)
    const codex = s2.sessions.find((s) => s.id === 'lws-codex-01')!
    expect(codex.messages.filter((m) => m.via === 'weevils')).toHaveLength(1)
    expect(codex.status).toBe('working')
  })
})

describe('intervention', () => {
  it('résoudre met le compteur à zéro et reprend la session, sans doublon', () => {
    const s0 = createInitialState(NOW)
    const resolve: Action = { type: 'resolve', interventionId: 'action-crm-01', choiceId: 'keep', at: NOW }
    const s1 = run(s0, resolve, resolve)
    expect(projectStats(s1, 'crm').pending).toBe(0)
    const s = s1.sessions.find((x) => x.id === 'crm-claude-01')!
    expect(s.status).toBe('working')
    expect(s.messages.filter((m) => m.role === 'event')).toHaveLength(1)
    expect(globalStats(s1).waiting).toBe(0)
  })
})

describe('événement terminal', () => {
  it('ajoute la session une seule fois, rejouable après remise à zéro', () => {
    const s0 = createInitialState(NOW)
    const ev: Action = { type: 'event/terminal', at: NOW }
    const s1 = run(s0, ev, ev)
    expect(s1.sessions.filter((s) => s.id === 'lws-codex-02')).toHaveLength(1)
    const s2 = run(s1, { type: 'reset', at: NOW }, ev)
    expect(s2.sessions.filter((s) => s.id === 'lws-codex-02')).toHaveLength(1)
  })
})

describe('h24', () => {
  it('pause puis reprise : compteurs cohérents et état restauré', () => {
    const s0 = createInitialState(NOW)
    expect(h24Stats(s0)).toEqual({ enabled: 2, running: 1, paused: 0 })
    const s1 = run(s0, { type: 'h24/toggle', id: 'h24-lws', at: NOW })
    expect(h24Stats(s1)).toEqual({ enabled: 1, running: 0, paused: 1 })
    const s2 = run(s1, { type: 'h24/toggle', id: 'h24-lws', at: NOW })
    expect(h24Stats(s2)).toEqual({ enabled: 2, running: 1, paused: 0 })
    expect(s2.h24.find((a) => a.id === 'h24-lws')!.runStartedAt).toBe(s0.h24.find((a) => a.id === 'h24-lws')!.runStartedAt)
  })
})

describe('classement', () => {
  it('accepter puis corriger : la conversation n’apparaît que dans un projet', () => {
    const s0 = createInitialState(NOW)
    const s1 = run(s0, { type: 'classify', conversationId: 'conv-unassigned-01', projectId: 'lws' })
    expect(s1.conversations.find((c) => c.id === 'conv-unassigned-01')!.suggestion).toBe('accepted')
    expect(projectStats(s1, 'lws').conversations).toBe(2)
    const s2 = run(s1, { type: 'classify', conversationId: 'conv-unassigned-01', projectId: 'crm' })
    expect(projectStats(s2, 'lws').conversations).toBe(1)
    expect(projectStats(s2, 'crm').conversations).toBe(2)
    expect(globalStats(s2).toSort).toBe(0)
  })
})

describe('remise à zéro', () => {
  it('repart d’une copie indépendante des fixtures et garde le thème', () => {
    const s0 = createInitialState(NOW)
    const s1 = run(s0, { type: 'theme', theme: 'dark' }, { type: 'resolve', interventionId: 'action-crm-01', choiceId: 'keep', at: NOW }, { type: 'reset', at: NOW })
    expect(s1.theme).toBe('dark')
    expect(projectStats(s1, 'crm').pending).toBe(1)
    expect(createInitialState(NOW).interventions[0].status).toBe('pending')
  })
})
