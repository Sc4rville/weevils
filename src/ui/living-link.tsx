// Living links (docs/LINKS.md): a link to a page weevils serves (/p/<kind>/<slug>) is bold, in its kind's colours,
// slowly drifting; a tap opens the page in place, full width, behind the weevils login.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import { device } from './setup'
import { pageLink, type PageInfo, type PageKind } from '../../shared/pages'
import { useT } from '../i18n'
import M from '../i18n/living-link'
import { useApp } from './app-context'
import { Icon } from './icons'
import { Shell } from './shell'
import './living-link.css'
import { linkCss } from '../../shared/link-colors'
import { startTour } from './tour-bus'
import { TRIES, type Try } from '../../shared/setup'

// The colours of each kind in each theme (shared/link-colors.ts), once per document.
if (typeof document !== 'undefined' && !document.getElementById('lk-colors')) {
  const style = document.createElement('style')
  style.id = 'lk-colors'
  style.textContent = linkCss()
  document.head.append(style)
}

/** A page link written in a message or a post, if it is one of this weevils' pages. */
export const livingLink = (href: string) => (typeof location === 'undefined' ? pageLink(href) : pageLink(href, [location.host]))

// The titles of the pages, for a bare link: fetched once, refreshed at most every minute.
let titles: Map<string, PageInfo> = new Map()
let fetchedAt = 0
const subs = new Set<() => void>()
function refresh() {
  if (Date.now() - fetchedAt < 60_000) return
  fetchedAt = Date.now()
  fetch('/api/pages', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { pages?: PageInfo[] } | null) => {
      if (!d?.pages) return
      titles = new Map(d.pages.map((p) => [p.slug, p]))
      subs.forEach((f) => f())
    })
    .catch(() => {})
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}

export function LivingLink({ href, label }: { href: string; label?: string }) {
  const link = livingLink(href)!
  // Outside the app (a test, a static render) the link is a plain link.
  let app: ReturnType<typeof useApp> | null = null
  try {
    app = useApp()
  } catch {}
  const known = useSyncExternalStore(subscribe, () => titles.get(link.slug))
  useEffect(() => {
    if (!label || label === href) refresh()
  }, [label, href])
  const bare = !label || label === href
  const text = bare ? known?.title ?? link.slug.replace(/-/g, ' ') : label
  return (
    <a
      className={`living lk-${link.kind}`}
      href={link.path}
      onClick={(e) => {
        e.stopPropagation()
        if (!app || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        app.push({ kind: 'webpage', path: link.path, title: text, pageKind: link.kind })
      }}
    >
      {text}
    </a>
  )
}

/**
 * A link to a place in the app, written by weevboss: `/#s=<session id or its first 8 characters>` opens that session,
 * `/#foryou` opens For you. Same living look as a page link (sessions blue, For you green); a tap stays in the app.
 */
export function appLink(href: string): { kind: 'session'; id: string } | { kind: 'foryou' } | { kind: 'do'; action: DoAction } | undefined {
  let u: URL
  try {
    u = new URL(href, 'http://local')
  } catch {
    return undefined
  }
  const ours = u.host === 'local' || (typeof location !== 'undefined' && u.host === location.host)
  if (!ours || (u.pathname !== '/' && u.pathname !== '')) return undefined
  const s = /^#s=([A-Za-z0-9_-]{4,})$/.exec(u.hash)
  if (s) return { kind: 'session', id: s[1] }
  const d = /^#do=([a-z]+(?:\.[a-z]+)?|claude\.[A-Za-z0-9_-]{1,64})$/.exec(u.hash)
  if (d && isDoAction(d[1])) return { kind: 'do', action: d[1] }
  return /^#foryou$/.test(u.hash) ? { kind: 'foryou' } : undefined
}

/** What a link in weevboss's own words does where it is (server/setup.ts act): sign GitHub in, pick ChatGPT (Codex)
 *  instead of Claude, set a server up, « later », show the recovery code; the onboarding journey's steps (the tour,
 *  the phone, notifications, another computer) and its examples to try (try.<example>, server/journey.ts TRIES); Claude's
 *  sign-in on another machine of yours (claude.<machine id>, server/machine-claude.ts).
 *  Never a button: a living link in the sentence (2026-11-22). */
export const DO_ACTIONS = ['github', 'codex', 'server', 'later', 'recovery', 'tour', 'phone', 'push', 'computer'] as const
export type DoAction = (typeof DO_ACTIONS)[number] | `try.${Try}` | `claude.${string}`
const isDoAction = (x: string): x is DoAction =>
  (DO_ACTIONS as readonly string[]).includes(x) || (x.startsWith('try.') && (TRIES as readonly string[]).includes(x.slice(4))) || /^claude\.[A-Za-z0-9_-]{1,64}$/.test(x)

export function AppLink({ href, label }: { href: string; label: string }) {
  const link = appLink(href)!
  let app: ReturnType<typeof useApp> | null = null
  try {
    app = useApp()
  } catch {}
  const [busy, setBusy] = useState(false)
  return (
    <a
      className={`living ${link.kind === 'session' ? 'lk-preview' : link.kind === 'do' ? 'lk-preview do' : 'lk-opportunities'}${busy ? ' busy' : ''}`}
      href={href}
      aria-busy={busy || undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (link.kind === 'do') {
          // Done here, whatever the app around it: the answer comes in weevboss's thread.
          e.preventDefault()
          if (busy) return
          // The tour plays here when this app has one (next); else the server says where it is.
          if (link.action === 'tour' && startTour()) return
          setBusy(true)
          void api.setupDo(link.action, device()).catch(() => undefined).finally(() => setBusy(false))
          return
        }
        if (!app || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        if (link.kind === 'foryou') return app.push({ kind: 'foryou' })
        // weevboss writes the short id it reads in its session list; the app opens the full one.
        const full = app.snap.sessions.find((x) => x.id === link.id) ?? app.snap.sessions.find((x) => x.id.startsWith(link.id))
        app.push({ kind: 'session', id: full?.id ?? link.id })
      }}
    >
      {label}
    </a>
  )
}

/** The page itself, in the app: its title, then the page. */
export function WebPage({ path, title, pageKind }: { path: string; title: string; pageKind: PageKind }) {
  const t = useT(M)
  return (
    <Shell
      slot="agent"
      kicker={t.kind(pageKind)}
      title={title}
      actions={
        <a className="key" href={path} target="_blank" rel="noreferrer" aria-label={t.openTab}>
          <Icon name="external" />
        </a>
      }
    >
      <div className="lp-frame">
        <iframe
          src={path}
          title={t.frame}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
          allow="clipboard-write; fullscreen; autoplay"
          referrerPolicy="no-referrer"
        />
      </div>
    </Shell>
  )
}
