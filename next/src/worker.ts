// weevils next and the app's service worker (public/sw.js): notifications, as in the classic app (src/main.tsx,
// src/App.tsx), from the same worker and the same push subscription. The worker never reloads next's pages on a new
// build of the classic app (next answers it is next); a tap on a notification opens what it points to here.
import { useEffect } from 'react'
import type { Snapshot } from '../../shared/api.ts'
import { ensurePush } from '../../src/push.ts'

export function registerWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'build?') e.ports[0]?.postMessage({ ui: 'next' })
  })
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined)
}

/** Where a notification's address leads: a session (« #s=<id> »), else weevboss. */
export const notificationTarget = (url: string): { session: string } | 'boss' => {
  const id = /[#&]s=([^&]+)/.exec(url)?.[1]
  return id ? { session: decodeURIComponent(id) } : 'boss'
}

export function useWorker(signedIn: boolean, snap: Snapshot | null, open: (to: { session: string } | 'boss') => void) {
  // Permission already given: this device subscribes again at each launch (a changed key, a reinstalled server…).
  useEffect(() => { if (signedIn) void ensurePush().catch(() => undefined) }, [signedIn])
  // Notifications already answered (a question replied to, a session back) are cleared on each snapshot.
  useEffect(() => {
    if (!snap) return
    navigator.serviceWorker?.controller?.postMessage({ type: 'notification-state', sessions: snap.sessions.map((s) => ({ id: s.id, status: s.status, archived: s.archived })), relayNeedsApproval: snap.relay?.plans?.some((p) => !p.resolved && (p.state === 'ready' || p.state === 'failed')) ?? false })
  }, [snap])
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'open') open(notificationTarget(String(e.data.url))) }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [open])
}
