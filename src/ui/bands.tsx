import { AnimatePresence, motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import type { MainMessage, Project } from '../../shared/api.ts'
import { api } from '../api'
import { prefetchRepo } from './pages'
import { ConvLine } from './convs'
import { useApp } from './app-context'
import { Appear, Collapse, Composer, Line, SessionRow, spring } from './bits'
import { ago, plural } from './format'

const color = (slot: string) => ({ '--c': `var(--${slot})` }) as CSSProperties

/** Taille du nom selon l'état de la bande : ouverte = grosse, les autres = fines lanières. Rien ne passe derrière. */
const NAME_SIZE = { open: '3rem', normal: '2.125rem', mini: '1.375rem' } as const

const working = (n: number) => `${n} ${n > 1 ? 'travaillent' : 'travaille'}`
/** « 2 travaillent », ou « 3 ouvertes » quand rien ne travaille. */
const activity = (list: { status: string }[]) => {
  const w = list.filter((s) => s.status === 'working').length
  return w ? working(w) : `${list.length} ${list.length > 1 ? 'ouvertes' : 'ouverte'}`
}

// ---------------------------------------------------------------------------
// Agent principal : la bande du haut, l'endroit central.

export function AgentBand() {
  const { snap, expanded, setExpanded, push, refresh } = useApp()
  const open = expanded === 'agent'
  const live = snap.sessions.filter((s) => s.status !== 'done')
  const att = snap.sessions.filter((s) => s.status === 'needs_user').length
  const running = snap.h24.filter((a) => a.runState === 'running').length
  const toSort = snap.conversations.filter((c) => c.status === 'pending')
  const summary = [
    live.length ? activity(live) : 'aucune session ouverte',
    att ? `${att} à toi` : null,
    snap.conversationCounts.pending ? `${snap.conversationCounts.pending} à ranger` : null,
    snap.classifier.running ? `classement… ${snap.classifier.queued}` : null,
    running ? `h24 ${running} en cours` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const examples = snap.projects
    .filter((p) => p.kind === 'repo')
    .slice(0, 2)
    .map((p) => `reprends ${p.name}`)

  const send = async (text: string) => {
    setExpanded('agent')
    const r = await api.main(text)
    refresh()
    if (r.route.kind === 'open' && r.route.sessionId) setTimeout(() => push({ kind: 'session', id: r.route.sessionId! }), 350)
  }

  return (
    <section className="band agent" style={color('agent')} aria-label="agent principal">
      <div className="in head">
        <button className="head-name" onClick={() => setExpanded(open ? null : 'agent')} aria-expanded={open} aria-controls="agent-body">
          <motion.span className="name" initial={false} animate={{ fontSize: expanded && !open ? NAME_SIZE.mini : NAME_SIZE.normal }} transition={spring}>
            weevils
          </motion.span>
        </button>
      </div>
      <div className="in meta summary">{summary}</div>

      <Collapse open={open} id="agent-body">
        <div aria-live="polite">
          <AnimatePresence initial={false}>
            {snap.main.slice(-4).map((m) => (
              <Appear key={m.id}>
                <MainMsg m={m} />
              </Appear>
            ))}
          </AnimatePresence>
        </div>
        {toSort.length > 0 && (
          <Line ch='"' onClick={() => push({ kind: 'conversations' })}>
            <span className="meta">{plural(toSort.length, 'conversation à ranger', 'conversations à ranger')}</span>
          </Line>
        )}
        {examples.length > 0 && (
          <div className="in meta" style={{ paddingBlock: 8 }}>
            essaie :{' '}
            <span className="inline-actions" style={{ display: 'inline-flex' }}>
              {examples.map((t) => (
                <button key={t} className="link" onClick={() => void send(t)}>
                  « {t} »
                </button>
              ))}
            </span>
          </div>
        )}
      </Collapse>

      <Composer placeholder="dis à weevils quoi faire" label="message à l’agent principal" onSend={send} onFocus={() => setExpanded('agent')} voice />
    </section>
  )
}

function MainMsg({ m }: { m: MainMessage }) {
  const { snap, push, refresh } = useApp()
  if (m.role === 'user') {
    return (
      <div className="msg band tone">
        <div className="in">
          <span className="who">toi</span>
          <div className="text">{m.text}</div>
        </div>
      </div>
    )
  }
  const open = m.ask && !m.ask.chosenSessionId
  const suggestions = open ? (m.ask!.suggestions ?? []) : []
  // Ancien format (sans suggestions) : les sessions pilotables, les plus récentes d'abord.
  const fallback = open && !suggestions.length ? snap.sessions.filter((s) => s.controllable && s.status !== 'done').slice(0, 6) : []
  const name = (id: string) => snap.projects.find((p) => p.id === id)?.name ?? id
  const pick = async (p: { suggestionId?: string; sessionId?: string }) => {
    const r = await api.choose(m.id, p)
    refresh()
    if (r.id) setTimeout(() => push({ kind: 'session', id: r.id! }), 350)
  }
  return (
    <div className="msg band">
      <div className="in">
        <span className="who">weevils</span>
        <div className="text">{m.text}</div>
        {m.targetSessionId && (
          <button className="link" onClick={() => push({ kind: 'session', id: m.targetSessionId! })}>
            ouvrir la session →
          </button>
        )}
      </div>
      {(suggestions.length > 0 || fallback.length > 0) && (
        <div className="chips" role="list" aria-label="où envoyer">
          {suggestions.map((sg, i) => (
            <button key={sg.id} className={`chip ${i === 0 ? 'best' : ''}`} role="listitem" onClick={() => void pick({ suggestionId: sg.id })}>
              <span className="chip-kind">{sg.kind === 'new' ? `+ nouvelle · ${name(sg.projectId)}` : `→ ${name(sg.projectId)} · ${sg.tool}`}</span>
              <span className="chip-title">{sg.title}</span>
              {sg.kind === 'session' && sg.detail && <span className="meta ellipsis">{sg.detail}</span>}
            </button>
          ))}
          {fallback.map((s) => (
            <button key={s.id} className="chip" role="listitem" onClick={() => void pick({ sessionId: s.id })}>
              <span className="chip-kind">→ {name(s.projectId)} · {s.tool}</span>
              <span className="chip-title">{s.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bande projet : nom fort, caractères-icônes, sessions. Elle s'ouvre, les autres se replient.

export function ProjectBand({ project }: { project: Project }) {
  const { snap, expanded, setExpanded, push, now, colors, setH24Open } = useApp()
  const [showDone, setShowDone] = useState(false)
  const mode = expanded === null ? 'normal' : expanded === project.id ? 'open' : 'mini'
  const sessions = snap.sessions.filter((s) => s.projectId === project.id)
  const active = sessions.filter((s) => s.status !== 'done')
  const done = sessions.filter((s) => s.status === 'done')
  const att = active.filter((s) => s.status === 'needs_user')
  const jobs = snap.h24.filter((a) => a.projectId === project.id)
  const convCount = snap.conversationCounts.byProject[project.id] ?? 0
  const convs = snap.conversations.filter((c) => c.projectId === project.id)
  const toggle = () => {
    if (mode !== 'open') for (const r of project.repos) prefetchRepo(r, project.where[r] ?? 'vps')
    setExpanded(mode === 'open' ? null : project.id)
  }

  const busy = active.some((s) => s.status === 'working')
  const summary = [
    active.length ? activity(active) : sessions.length ? 'rien ne tourne' : null,
    att.length ? `${att.length} à toi` : null,
    convCount ? plural(convCount, 'conversation', 'conversations') : null,
    !active.length ? ago(now - project.lastActivityAt) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <motion.section layout="position" transition={spring} className={`band ${busy ? 'busy' : ''}`} style={color(colors[project.id] ?? 'p0')} aria-label={`projet ${project.name}`} data-project={project.id}>
      <motion.div className="in head" initial={false} animate={{ minHeight: mode === 'mini' ? 50 : 64, paddingTop: mode === 'mini' ? 0 : 8 }} transition={spring}>
        <button className="head-name" onClick={toggle} aria-expanded={mode === 'open'} aria-controls={`more-${project.id}`}>
          <motion.span className="name" initial={false} animate={{ fontSize: NAME_SIZE[mode] }} transition={spring}>
            {project.name}
            {active.some((s) => s.status === 'working') && (
              <span className="fluo" aria-hidden>
                {' '}
                *
              </span>
            )}
          </motion.span>
          <AnimatePresence initial={false}>
            {mode === 'mini' && (
              <motion.span key="s" className="meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {summary}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        {mode !== 'mini' && (
          <div className="chars">
            {project.repos.length > 0 && (
              <button className="ch" aria-label={`fichiers de ${project.name}`} onClick={() => push({ kind: 'files', projectId: project.id })}>
                /
              </button>
            )}
            <button className="ch" aria-label={`machine de ${project.name}`} onClick={() => push({ kind: 'machine', projectId: project.id })}>
              @
            </button>
            <button
              className={`ch ${att.length ? '' : 'off'}`}
              disabled={!att.length}
              aria-label={att.length ? `${plural(att.length, 'session attend', 'sessions attendent')} ta réponse` : 'rien ne t’attend'}
              onClick={() => att[0] && push({ kind: 'session', id: att[0].id })}
            >
              <span>
                !{att.length > 0 && <sup>{att.length}</sup>}
              </span>
            </button>
            {convCount > 0 && (
              <button className="ch" aria-label={`${plural(convCount, 'conversation', 'conversations')} de ${project.name}`} onClick={() => push({ kind: 'conversations', projectId: project.id })}>
                <span>
                  "<sup>{convCount}</sup>
                </span>
              </button>
            )}
            {project.kind === 'repo' || project.repos.length > 0 ? (
              <button className="ch" aria-label={`nouvelle session dans ${project.name}`} onClick={() => push({ kind: 'new', projectId: project.id })}>
                +
              </button>
            ) : null}
          </div>
        )}
      </motion.div>

      <Collapse open={mode !== 'mini'}>
        {project.kind === 'invented' && (
          <div className="in meta" style={{ paddingBottom: 6 }}>
            catégorie inventée par weevils · hors repo
          </div>
        )}
        <AnimatePresence initial={false}>
          {active.map((s) => (
            <Appear key={s.id}>
              <SessionRow session={s} />
            </Appear>
          ))}
        </AnimatePresence>
        {active.length === 0 && sessions.length > 0 && <div className="in meta empty">rien ne tourne · dernière activité {ago(now - project.lastActivityAt)}</div>}
        {sessions.length === 0 && mode === 'normal' && convs.slice(0, 3).map((c) => <ConvLine key={c.id} c={c} />)}
        {done.length > 0 && (
          <>
            <Line ch="✓" go={showDone ? '−' : '+'} onClick={() => setShowDone((v) => !v)} label={`${done.length} sessions terminées`}>
              <span className="meta">{plural(done.length, 'session terminée', 'sessions terminées')}</span>
            </Line>
            <Collapse open={showDone}>
              {done.slice(0, 6).map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </Collapse>
          </>
        )}
        <div style={{ height: 12 }} />
      </Collapse>

      <Collapse open={mode === 'open'} id={`more-${project.id}`}>
        <div className="band tone">
          {convCount > 0 && <div className="in label">conversations</div>}
          {convs.slice(0, 4).map((c) => (
            <ConvLine key={c.id} c={c} />
          ))}
          {convCount > 4 && (
            <Line ch='"' onClick={() => push({ kind: 'conversations', projectId: project.id })}>
              <span className="meta">les {convCount} conversations</span>
            </Line>
          )}
          {project.repos.length > 0 && <div className="in label">repos</div>}
          {project.repos.map((r) => (
            <Line key={r} ch="/" meta={`${project.where[r] ?? 'vps'} · parcourir les fichiers`} onClick={() => push({ kind: 'files', projectId: project.id, repo: r })}>
              {r}
            </Line>
          ))}
          <div className="in label">machines</div>
          <Line ch="@" meta={plural(active.length, 'session ouverte', 'sessions ouvertes')} onClick={() => push({ kind: 'machine', projectId: project.id })}>
            {[...new Set(sessions.map((s) => s.machineId))].join(' · ') || snap.machines[0]?.name}
          </Line>
          {jobs.length > 0 && <div className="in label">h24</div>}
          {jobs.map((a) => (
            <Line key={a.id} ch={a.runState === 'running' ? <span className="spin">*</span> : '✓'} meta={a.runState === 'running' ? 'en cours' : a.lastEvent} onClick={() => setH24Open(true)} go="↓">
              {a.title}
            </Line>
          ))}
          <div style={{ height: 14 }} />
        </div>
      </Collapse>
    </motion.section>
  )
}

// ---------------------------------------------------------------------------
// Bande de fin : réglages et état de la connexion. Elle remplit l'espace jusqu'au rail H24.

const b64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Notifications : abonnement Web Push (iPhone : seulement depuis l'app installée sur l'écran d'accueil). */
function NotifyLine() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const standalone = typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)
  const ios = /iphone|ipad/i.test(navigator.userAgent)
  const [state, setState] = useState<'idle' | 'busy' | 'on' | 'error'>(supported && Notification.permission === 'granted' ? 'on' : 'idle')
  const [msg, setMsg] = useState<string | null>(null)
  const enable = async () => {
    setState('busy')
    setMsg(null)
    try {
      const info = await api.push()
      if (!info.enabled) throw new Error('notifications indisponibles sur le serveur')
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') throw new Error('autorisation refusée (réglages de l’iPhone → weevils → notifications)')
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(info.publicKey) }))
      await api.pushSubscribe(sub.toJSON())
      await api.pushTest()
      setState('on')
      setMsg('notification de test envoyée')
    } catch (e) {
      setState('error')
      setMsg((e as Error).message)
    }
  }
  if (!supported || (ios && !standalone)) {
    return (
      <Line ch="!" go={null} meta="installe weevils sur l’écran d’accueil (Partager → Sur l’écran d’accueil), puis active-les depuis l’app">
        notifications
      </Line>
    )
  }
  return (
    <Line ch="!" go={null} meta={msg ?? (state === 'on' ? 'activées · quand une session t’attend ou a fini' : 'te prévenir quand une session t’attend ou a fini')} onClick={() => void enable()}>
      notifications {state === 'on' ? '· activées' : state === 'busy' ? '…' : ''}
    </Line>
  )
}

export function FootBand() {
  const { snap, theme, setTheme, offline, colors, logout, push } = useApp()
  const dark = theme === 'dark'
  return (
    <section className="band demo" style={color(colors.__foot ?? 'p3')} aria-label="réglages">
      <div className="in head">
        <h2 className="h2" style={{ margin: 0 }}>
          machines
        </h2>
        <span className="chars meta strong">{offline ? 'reconnexion…' : ''}</span>
      </div>
      {snap.machines.map((m) => (
        <Line key={m.id} ch="@" meta={m.online === false ? 'hors ligne' : 'en ligne'} onClick={() => push({ kind: 'machine', projectId: '' })}>
          {m.name}
        </Line>
      ))}
      <Line ch="+" meta="dans n’importe quel repo, sur la machine de ton choix" onClick={() => push({ kind: 'new', projectId: '__any' })}>
        nouvelle session ailleurs
      </Line>
      <Line ch='"' meta={`${plural(snap.conversationCounts.total, 'importée', 'importées')} · chatgpt et claude.ai`} onClick={() => push({ kind: 'conversations' })}>
        conversations
      </Line>
      <Line ch="↑" meta="export ChatGPT ou Claude.ai (.zip)" onClick={() => push({ kind: 'import' })}>
        importer des conversations
      </Line>
      <NotifyLine />
      <Line ch="~" meta={`passer en ${dark ? 'clair' : 'sombre'}`} go={null} onClick={() => setTheme(dark ? 'light' : 'dark')}>
        thème {dark ? 'sombre' : 'clair'}
      </Line>
      <div className="in meta" style={{ paddingBlock: 10 }}>
        Pour qu’une session ouverte dans un terminal soit pilotable d’ici, lance-la avec <span className="strong">wv</span> (ou <span className="strong">wv codex</span>).
      </div>
      <Line ch="x" meta="cet appareil devra se reconnecter" go={null} onClick={logout}>
        se déconnecter
      </Line>
    </section>
  )
}
