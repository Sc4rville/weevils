// weevils next — the data: only weevilsd's API (/api), like the main app. Nothing faked.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message, SessionDetail, Snapshot } from '../../shared/api.ts'

export async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? res.statusText), { status: res.status })
  return data as T
}

export type Auth = 'checking' | 'in' | 'out'

/** Sign-in: the usual login link with this host (#k=<code>), or the access code typed once. */
export function useAuth(): [Auth, (code: string) => Promise<void>, () => void] {
  const [auth, setAuth] = useState<Auth>('checking')
  useEffect(() => {
    const m = /#k=([\w-]+)/.exec(location.hash)
    const first = m
      ? (history.replaceState(null, '', location.pathname), call('POST', '/api/login', { secret: m[1] }).then(() => true, () => false))
      : Promise.resolve(false)
    void first
      .then((ok) => ok || call<{ authed: boolean }>('GET', '/api/me').then((r) => r.authed, () => false))
      .then((ok) => setAuth(ok ? 'in' : 'out'))
  }, [])
  const login = useCallback(async (code: string) => {
    await call('POST', '/api/login', { secret: code.trim() })
    setAuth('in')
  }, [])
  const logout = useCallback(() => void call('POST', '/api/logout', {}).finally(() => setAuth('out')), [])
  return [auth, login, logout]
}

/** The snapshot, kept live: the server's event stream says when its version moves, and we fetch it again. */
export function useSnapshot(enabled: boolean): { snap: Snapshot | null; reload: () => void } {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const have = useRef(0)
  const busy = useRef(false)
  const again = useRef(false)
  const load = useCallback(() => {
    if (busy.current) return void (again.current = true)
    busy.current = true
    call<Snapshot>('GET', '/api/snapshot')
      .then((s) => { have.current = s.version; setSnap(s) })
      .catch(() => {})
      .finally(() => {
        busy.current = false
        if (again.current) { again.current = false; load() }
      })
  }, [])
  useEffect(() => {
    if (!enabled) return
    let es: EventSource | null = null
    const open = () => {
      es = new EventSource('/api/events')
      es.onopen = () => load()
      es.addEventListener('version', (e) => {
        if (Number((e as MessageEvent).data) > have.current) load()
      })
    }
    open()
    // iOS drops the stream when the app goes to the background: reopen and refresh when it comes back.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!es || es.readyState === 2) { es?.close(); open() }
      load()
    }
    document.addEventListener('visibilitychange', onVisible)
    const poll = setInterval(() => document.visibilityState === 'visible' && load(), 30_000)
    return () => {
      es?.close()
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, load])
  return { snap, reload: load }
}

/** One session's thread, fetched again each time the snapshot moves. */
export function useSession(id: string | null, version: number): { detail: SessionDetail | null; reload: () => void } {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!id) return setDetail(null)
    let gone = false
    call<SessionDetail>('GET', `/api/sessions/${encodeURIComponent(id)}`).then((d) => !gone && setDetail(d), () => {})
    return () => { gone = true }
  }, [id, version, tick])
  useEffect(() => setDetail(null), [id])
  return { detail, reload: () => setTick((t) => t + 1) }
}

/** What a thread shows: what people said, without the machinery (tool steps, coordination between agents). */
export const visible = (m: Message) => !m.coordination && m.role !== 'event' && m.text.trim() !== ''
