import { scenario } from '../data/scenario'
import type { Conversation, H24Activity, MainMessage, Message, Session, State, Theme, Tool } from './types'

export const STORAGE_KEY = 'weevils-demo-v1'

const S = 1000

export function createInitialState(now: number, theme: Theme = 'light'): State {
  const msg = (m: { id: string; role: Message['role']; text: string; agoSeconds?: number }, fallbackAt: number): Message => ({
    id: m.id,
    role: m.role,
    text: m.text,
    at: m.agoSeconds != null ? now - m.agoSeconds * S : fallbackAt,
  })

  const sessions: Session[] = scenario.sessions.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    machineId: s.machineId,
    tool: s.tool,
    title: s.title,
    status: s.status,
    origin: s.origin,
    openedAt: now - s.openedSeconds * S,
    workStartedAt: s.status === 'working' ? now - s.workSeconds * S : null,
    messages: s.messages.map((m) => msg(m, now)),
    subagents: s.subagents.map((a) => ({
      id: a.id,
      label: a.label,
      activity: a.activity,
      status: a.status,
      startedAt: now - a.elapsedSeconds * S - (a.status === 'done' ? 120 * S : 0),
      endedAt: a.status === 'done' ? now - 120 * S : undefined,
    })),
  }))

  const conversations: Conversation[] = scenario.conversations.map((c) => ({
    id: c.id,
    source: c.source,
    title: c.title,
    projectId: c.projectId,
    updatedAt: now - c.agoSeconds * S,
    suggestedProjectId: c.suggestedProjectId,
    suggestionReason: c.suggestionReason,
    suggestion: c.suggestedProjectId ? 'pending' : undefined,
    messages: c.messages.map((m, i) => msg(m, now - c.agoSeconds * S + i * 60 * S)),
  }))

  const h24: H24Activity[] = scenario.h24.map((a) => ({
    id: a.id,
    projectId: a.projectId,
    title: a.title,
    schedule: a.schedule,
    enabled: a.enabled,
    runState: a.runState,
    runStartedAt: a.runState === 'running' ? now - a.runSeconds * S : null,
    lastEvent: a.lastEvent,
  }))

  return {
    version: 1,
    theme,
    machines: scenario.machines.map((m) => ({ ...m })),
    projects: scenario.projects.map((p) => ({ ...p, repo: p.repo ? { ...p.repo, files: p.repo.files.map((f) => ({ ...f })) } : null })),
    sessions,
    interventions: scenario.interventions.map((i) => ({ ...i, choices: i.choices.map((c) => ({ ...c })), status: 'pending' as const })),
    conversations,
    h24,
    main: [{ id: 'main-greeting', role: 'assistant', text: scenario.mainGreeting, at: now }],
    firedEvents: [],
  }
}

// ---------------------------------------------------------------------------
// Routage de l'agent principal : déterministe et local, aucune IA.

export type Route =
  | { kind: 'forward'; sessionId: string }
  | { kind: 'open'; sessionId: string }
  | { kind: 'unknown' }

const normalize = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const statusRank: Record<Session['status'], number> = { needs_user: 0, working: 1, idle: 2, done: 3 }

export function routeCommand(state: State, text: string): Route {
  const n = normalize(text)
  if (!n) return { kind: 'unknown' }
  const words = n.split(' ')
  const project = state.projects.find((p) => words.includes(normalize(p.name)))
  if (!project) return { kind: 'unknown' }
  const tool: Tool | null = words.includes('claude') ? 'claude' : words.includes('codex') ? 'codex' : null
  const candidates = state.sessions
    .filter((s) => s.projectId === project.id && s.status !== 'done' && (!tool || s.tool === tool))
    .sort((a, b) => statusRank[a.status] - statusRank[b.status] || a.openedAt - b.openedAt)
  const target = candidates[0]
  if (!target) return { kind: 'unknown' }
  const isOpen = /^(ouvre|ouvrir|montre|affiche|va)\b/.test(n)
  return { kind: isOpen ? 'open' : 'forward', sessionId: target.id }
}

// ---------------------------------------------------------------------------
// Actions

export type Target = { kind: 'session' | 'conversation'; id: string }

export type Action =
  | { type: 'theme'; theme: Theme }
  | { type: 'send'; target: Target; msgId: string; text: string; at: number; via?: 'weevils' }
  | { type: 'reply'; target: Target; msgId: string; at: number }
  | { type: 'main/send'; msgId: string; text: string; route: Route; at: number }
  | { type: 'main/choose'; mainMsgId: string; sessionId: string; at: number }
  | { type: 'resolve'; interventionId: string; choiceId: string; at: number }
  | { type: 'session/create'; id: string; projectId: string; tool: Tool; title: string; text: string; at: number }
  | { type: 'event/terminal'; at: number }
  | { type: 'h24/toggle'; id: string; at: number }
  | { type: 'classify'; conversationId: string; projectId: string }
  | { type: 'reset'; at: number }
  | { type: 'replace'; state: State }

const hasMsg = (list: { id: string }[], id: string) => list.some((m) => m.id === id)

function updateSession(state: State, id: string, fn: (s: Session) => Session): State {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) }
}

function appendToSession(state: State, sessionId: string, message: Message): State {
  return updateSession(state, sessionId, (s) => {
    if (hasMsg(s.messages, message.id)) return s
    // Un message réveille une session disponible ; il ne débloque pas une session qui attend un choix.
    const wakes = s.status === 'idle' && message.role === 'user'
    return {
      ...s,
      status: wakes ? 'working' : s.status,
      workStartedAt: wakes ? message.at : s.workStartedAt,
      messages: [...s.messages, message],
    }
  })
}

export function sessionLabel(state: State, sessionId: string): string {
  const s = state.sessions.find((x) => x.id === sessionId)
  if (!s) return 'session inconnue'
  const p = state.projects.find((x) => x.id === s.projectId)
  return `${p?.name ?? '?'} · ${s.tool} · « ${s.title} »`
}

function sessionReply(state: State, s: Session): string {
  if (s.status === 'needs_user') {
    const pending = state.interventions.find((i) => i.sessionId === s.id && i.status === 'pending')
    return pending ? `Démo : reçu. J’attends toujours ton choix : « ${pending.title} ».` : 'Démo : reçu.'
  }
  if (s.status === 'done') return 'Démo : cette session est terminée. Ouvre-en une nouvelle avec +.'
  return 'Démo : reçu, je l’intègre au travail en cours.'
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'theme':
      return { ...state, theme: action.theme }

    case 'send': {
      const text = action.text.trim()
      if (!text) return state
      const message: Message = { id: action.msgId, role: 'user', text, at: action.at, via: action.via }
      if (action.target.kind === 'session') return appendToSession(state, action.target.id, message)
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.target.id && !hasMsg(c.messages, message.id)
            ? { ...c, updatedAt: action.at, messages: [...c.messages, message] }
            : c,
        ),
      }
    }

    case 'reply': {
      // La réponse « <id>-r » n'existe que si le message « <id> » existe encore (sinon : remise à zéro entre-temps).
      const source = action.msgId.replace(/-r$/, '')
      if (action.target.kind === 'session') {
        const s = state.sessions.find((x) => x.id === action.target.id)
        if (!s || hasMsg(s.messages, action.msgId) || !hasMsg(s.messages, source)) return state
        return appendToSession(state, s.id, { id: action.msgId, role: 'assistant', text: sessionReply(state, s), at: action.at })
      }
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.target.id && !hasMsg(c.messages, action.msgId) && hasMsg(c.messages, source)
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { id: action.msgId, role: 'assistant', text: `Démo : réponse simulée. Rien n’est envoyé à ${c.source === 'chatgpt' ? 'ChatGPT' : 'Claude'}.`, at: action.at },
                ],
              }
            : c,
        ),
      }
    }

    case 'main/send': {
      const text = action.text.trim()
      if (!text || hasMsg(state.main, action.msgId)) return state
      const user: MainMessage = { id: action.msgId, role: 'user', text, at: action.at }
      const r = action.route
      if (r.kind === 'unknown') {
        const reply: MainMessage = {
          id: `${action.msgId}-a`,
          role: 'assistant',
          text: 'Démo : je ne sais pas encore où envoyer ça. Choisis la session :',
          at: action.at,
          ask: { text },
        }
        return { ...state, main: [...state.main, user, reply] }
      }
      const label = sessionLabel(state, r.sessionId)
      if (r.kind === 'open') {
        const reply: MainMessage = { id: `${action.msgId}-a`, role: 'assistant', text: `J’ouvre ${label}.`, at: action.at, targetSessionId: r.sessionId }
        return { ...state, main: [...state.main, user, reply] }
      }
      const target = state.sessions.find((s) => s.id === r.sessionId)
      const stillWaiting = target?.status === 'needs_user' ? ' Elle attend toujours ton choix.' : ''
      const reply: MainMessage = { id: `${action.msgId}-a`, role: 'assistant', text: `Envoyé à ${label}.${stillWaiting}`, at: action.at, targetSessionId: r.sessionId }
      const next = appendToSession(state, r.sessionId, { id: `${action.msgId}-f`, role: 'user', text, at: action.at, via: 'weevils' })
      return { ...next, main: [...next.main, user, reply] }
    }

    case 'main/choose': {
      const ask = state.main.find((m) => m.id === action.mainMsgId)
      if (!ask?.ask || ask.ask.chosenSessionId) return state
      const label = sessionLabel(state, action.sessionId)
      const withChoice = {
        ...state,
        main: state.main.map((m) => (m.id === action.mainMsgId ? { ...m, ask: { ...m.ask!, chosenSessionId: action.sessionId } } : m)),
      }
      const next = appendToSession(withChoice, action.sessionId, { id: `${action.mainMsgId}-f`, role: 'user', text: ask.ask.text, at: action.at, via: 'weevils' })
      return {
        ...next,
        main: [...next.main, { id: `${action.mainMsgId}-c`, role: 'assistant', text: `Envoyé à ${label}.`, at: action.at, targetSessionId: action.sessionId }],
      }
    }

    case 'resolve': {
      const it = state.interventions.find((i) => i.id === action.interventionId)
      const choice = it?.choices.find((c) => c.id === action.choiceId)
      if (!it || !choice || it.status !== 'pending') return state
      const withResolved = {
        ...state,
        interventions: state.interventions.map((i) => (i.id === it.id ? { ...i, status: 'resolved' as const, resolvedChoiceId: choice.id } : i)),
      }
      return updateSession(withResolved, it.sessionId, (s) => ({
        ...s,
        status: 'working',
        workStartedAt: action.at,
        messages: [
          ...s.messages,
          { id: `${it.id}-choice`, role: 'user', text: choice.label, at: action.at },
          { id: `${it.id}-event`, role: 'event', text: choice.eventMessage, at: action.at },
        ],
      }))
    }

    case 'session/create': {
      if (state.sessions.some((s) => s.id === action.id)) return state
      const text = action.text.trim()
      const session: Session = {
        id: action.id,
        projectId: action.projectId,
        machineId: state.machines[0]?.id ?? 'local',
        tool: action.tool,
        title: action.title.trim() || (text ? text.slice(0, 40) : 'nouvelle session'),
        status: text ? 'working' : 'idle',
        origin: 'weevils · démo',
        openedAt: action.at,
        workStartedAt: text ? action.at : null,
        messages: text ? [{ id: `${action.id}-m1`, role: 'user', text, at: action.at }] : [],
        subagents: [],
      }
      return { ...state, sessions: [...state.sessions, session] }
    }

    case 'event/terminal': {
      const ev = scenario.terminalEvent
      if (state.firedEvents.includes(ev.id) || state.sessions.some((s) => s.id === ev.session.id)) return state
      const { text, ...rest } = ev.session
      const session: Session = {
        ...rest,
        status: 'working',
        openedAt: action.at,
        workStartedAt: action.at,
        messages: [{ id: `${ev.id}-m`, role: 'event', text, at: action.at }],
        subagents: [],
      }
      return { ...state, sessions: [...state.sessions, session], firedEvents: [...state.firedEvents, ev.id] }
    }

    case 'h24/toggle':
      return {
        ...state,
        h24: state.h24.map((a) => {
          if (a.id !== action.id) return a
          if (a.runState === 'paused' && a.beforePause) {
            const b = a.beforePause
            return {
              ...a,
              enabled: b.enabled,
              runState: b.runState,
              runStartedAt: b.runState === 'running' ? (b.runStartedAt ?? action.at) : null,
              beforePause: undefined,
              lastEvent: 'Repris.',
            }
          }
          return {
            ...a,
            beforePause: { enabled: a.enabled, runState: a.runState, runStartedAt: a.runStartedAt },
            enabled: false,
            runState: 'paused',
            lastEvent: 'Mis en pause.',
          }
        }),
      }

    case 'classify':
      return {
        ...state,
        conversations: state.conversations.map((c) => {
          if (c.id !== action.conversationId) return c
          const accepted = c.suggestion === 'pending' && action.projectId === c.suggestedProjectId
          return { ...c, projectId: action.projectId, suggestion: accepted ? 'accepted' : 'corrected' }
        }),
      }

    case 'reset':
      return createInitialState(action.at, state.theme)

    case 'replace':
      return action.state
  }
}

// ---------------------------------------------------------------------------
// Sélecteurs : tous les compteurs sont dérivés de l'état courant.

export function projectStats(state: State, projectId: string) {
  const sessions = state.sessions.filter((s) => s.projectId === projectId)
  return {
    sessions: sessions.length,
    working: sessions.filter((s) => s.status === 'working').length,
    waiting: sessions.filter((s) => s.status === 'needs_user').length,
    pending: state.interventions.filter((i) => i.projectId === projectId && i.status === 'pending').length,
    conversations: state.conversations.filter((c) => c.projectId === projectId).length,
  }
}

export function h24Stats(state: State) {
  return {
    enabled: state.h24.filter((a) => a.enabled).length,
    running: state.h24.filter((a) => a.enabled && a.runState === 'running').length,
    paused: state.h24.filter((a) => a.runState === 'paused').length,
  }
}

export function globalStats(state: State) {
  return {
    working: state.sessions.filter((s) => s.status === 'working').length,
    waiting: state.interventions.filter((i) => i.status === 'pending').length,
    toSort: state.conversations.filter((c) => c.suggestion === 'pending').length,
  }
}

// ---------------------------------------------------------------------------
// Persistance locale (confort de démo uniquement).

export function loadState(now: number): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as State
      if (parsed?.version === 1 && Array.isArray(parsed.sessions)) return parsed
    }
  } catch {
    /* stockage indisponible : on repart des fixtures */
  }
  const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  return createInitialState(now, prefersDark ? 'dark' : 'light')
}

export function saveState(state: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignoré */
  }
}

let seq = 0
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`
