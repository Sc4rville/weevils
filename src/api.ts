// Client de weevilsd : appels REST + flux temps réel (SSE). Aucune donnée fictive.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionDetail, Snapshot, Tool } from '../shared/api.ts'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: (() => void) | null = null

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/login')) onUnauthorized?.()
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText)
  }
  return data as T
}

const enc = encodeURIComponent

export interface FileContent {
  path: string
  size: number
  binary: boolean
  content: string
  truncated: boolean
}

export const api = {
  me: () => call<{ authed: boolean }>('GET', '/api/me'),
  login: (secret: string) => call<{ ok: true }>('POST', '/api/login', { secret }),
  logout: () => call<{ ok: true }>('POST', '/api/logout', {}),
  snapshot: () => call<Snapshot>('GET', '/api/snapshot'),
  session: (id: string) => call<SessionDetail>('GET', `/api/sessions/${enc(id)}`),
  screen: (id: string) => call<{ screen: string | null }>('GET', `/api/sessions/${enc(id)}/screen`),
  send: (id: string, text: string) => call<{ id: string }>('POST', `/api/sessions/${enc(id)}/send`, { text }),
  key: (id: string, key: string) => call<{ ok: true }>('POST', `/api/sessions/${enc(id)}/key`, { key }),
  create: (body: { projectId: string; repo?: string; tool: Tool; text: string }) => call<{ id: string }>('POST', '/api/sessions', body),
  main: (text: string) => call<{ route: { kind: string; sessionId?: string } }>('POST', '/api/main', { text }),
  choose: (mainId: string, sessionId: string) => call<{ ok: true }>('POST', '/api/main/choose', { mainId, sessionId }),
  toggleH24: (id: string) => call<{ ok: true }>('POST', `/api/h24/${enc(id)}/toggle`, {}),
  files: (repo: string) => call<{ files: string[] }>('GET', `/api/repos/${enc(repo)}/files`),
  file: (repo: string, path: string) => call<FileContent>('GET', `/api/repos/${enc(repo)}/file?path=${enc(path)}`),
}

/** Connexion + instantané tenu à jour par le flux SSE (le serveur annonce une version, on recharge). */
export function useLive() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [offline, setOffline] = useState(false)
  const loader = useRef<() => void>(() => undefined)

  useEffect(() => {
    onUnauthorized = () => setAuthed(false)
    // Lien de connexion « #k=<code> » (QR code) : on se connecte puis on efface le code de l'adresse.
    const m = /#k=([\w-]+)/.exec(location.hash)
    const start = m
      ? (history.replaceState(null, '', location.pathname), api.login(m[1]).then(() => ({ authed: true }), () => api.me()))
      : api.me()
    start.then((r) => setAuthed(r.authed)).catch(() => setOffline(true))
    return () => {
      onUnauthorized = null
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    let stopped = false
    let inflight = false
    let wanted = 0
    let have = 0
    const load = async () => {
      if (inflight) return
      inflight = true
      try {
        const s = await api.snapshot()
        have = s.version
        if (!stopped) {
          setSnap(s)
          setOffline(false)
        }
      } catch (e) {
        if (!(e instanceof ApiError)) setOffline(true)
      } finally {
        inflight = false
        if (wanted > have && !stopped) void load()
      }
    }
    loader.current = () => void load()
    void load()
    const es = new EventSource('/api/events')
    es.addEventListener('version', (e) => {
      wanted = Number((e as MessageEvent).data)
      if (wanted > have) void load()
    })
    es.onerror = () => setOffline(true)
    es.onopen = () => {
      setOffline(false)
      void load()
    }
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      es.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [authed])

  const refresh = useCallback(() => loader.current(), [])
  return { authed, setAuthed, snap, offline, refresh }
}
