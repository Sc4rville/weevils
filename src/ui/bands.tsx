import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Project } from '../../shared/api.ts'
import { api } from '../api'
import { prefetchRepo } from './pages'
import { ConvLine } from './convs'
import { useApp } from './app-context'
import { Appear, Collapse, Composer, Line, Messages, SessionRow, Working, spring } from './bits'
import { Settings, shortModel } from './settings'
import { ago, plain, plural, step } from './format'

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
// weevils, l'orchestrateur : la bande du haut est juste un chat. Lui écrit dans les sessions.

function useStickBottom(ref: React.RefObject<HTMLDivElement | null>, count: number, open: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!el || !open) return
    const t = setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }), 80)
    return () => clearTimeout(t)
  }, [ref, count, open])
}

export function AgentBand() {
  const { snap, expanded, setExpanded } = useApp()
  const open = expanded === 'agent'
  const [settingsOpen, setSettingsOpen] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const live = snap.sessions.filter((s) => s.status !== 'done')
  const att = snap.sessions.filter((s) => s.status === 'needs_user').length
  const running = snap.h24.filter((a) => a.runState === 'running').length
  const model = shortModel(snap.mainSettings?.model)
  const summary = [live.length ? activity(live) : 'aucune session ouverte', att ? `${att} à toi` : null, running ? `h24 ${running} en cours` : null, model].filter(Boolean).join(' · ')
  const last = snap.main[snap.main.length - 1]
  useStickBottom(body, snap.main.length, open)

  const send = async (text: string) => {
    setExpanded('agent')
    await api.main(text)
  }
  const attach = async (text: string, files: { name: string; type: string; data: string }[]) => {
    setExpanded('agent')
    await api.mainAttach(text, files)
  }

  return (
    <section className="band agent" style={color('agent')} aria-label="weevils, l’orchestrateur">
      <div className="in head">
        <button className="head-name" onClick={() => setExpanded(open ? null : 'agent')} aria-expanded={open} aria-controls="agent-body">
          <motion.span className="name" initial={false} animate={{ fontSize: expanded && !open ? NAME_SIZE.mini : NAME_SIZE.normal }} transition={spring}>
            weevils
            {snap.mainWorking && (
              <span className="fluo" aria-hidden>
                {' '}
                *
              </span>
            )}
          </motion.span>
        </button>
        <button className="ch" onClick={() => setSettingsOpen((v) => !v)} aria-label="réglages de weevils" aria-expanded={settingsOpen} aria-controls="agent-settings">
          ~
        </button>
      </div>
      <div className="in meta summary">{summary}</div>
      <Collapse open={settingsOpen} id="agent-settings">
        <div className="band tone">
          <Settings id="__main" tool="claude" settings={snap.mainSettings} canCommand={snap.mainHasScreen} run={(c) => api.mainCommand(c)} />
        </div>
      </Collapse>

      {/* Replié : la dernière réponse de weevils, en une ligne. Ouvert : la conversation, qui grandit sans tout envahir. */}
      {!open && last && last.role !== 'user' && (
        <button className="row" onClick={() => setExpanded('agent')} aria-label="ouvrir la conversation avec weevils">
          <span className="in">
            <span className="stack-text">
              <span className="ellipsis">
                <span className="strong">{last.role === 'event' ? '→ ' : 'weevils · '}</span>
                {last.role === 'event' ? step(last.text) : plain(last.text).split('\n')[0]}
              </span>
            </span>
          </span>
        </button>
      )}
      <Collapse open={open} id="agent-body">
        <div ref={body} className="chat" aria-live="polite">
          <Messages messages={snap.main} author="weevils" working={snap.mainWorking} />
          {snap.mainWorking && <Working author="weevils" />}
        </div>
      </Collapse>

      {/* Écrire ici n'ouvre pas la conversation : elle s'ouvre à l'envoi, pour lire la réponse. */}
      <Composer placeholder="dis à weevils quoi faire" label="message à weevils" onSend={send} onAttach={attach} anyFile voice />
    </section>
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
  // Rien ne tourne : une seule ligne (nom et actions), le détail n'apparaît qu'au tap sur le nom.
  const compact = active.length === 0 && mode === 'normal'
  const doneOpen = showDone || (mode === 'open' && active.length === 0)

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
      <motion.div className="in head" initial={false} animate={{ minHeight: mode === 'mini' ? 50 : compact ? 56 : 64, paddingTop: mode === 'mini' || compact ? 0 : 8 }} transition={spring}>
        <button className="head-name" onClick={toggle} aria-expanded={mode === 'open'} aria-controls={`more-${project.id}`}>
          <motion.span className="name" initial={false} animate={{ fontSize: compact ? '1.75rem' : NAME_SIZE[mode] }} transition={spring}>
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

      <Collapse open={mode !== 'mini' && !compact}>
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
            <Line ch="✓" go={doneOpen ? '↑' : '↓'} onClick={() => setShowDone(!doneOpen)} label={`${done.length} sessions terminées`}>
              <span className="meta">{plural(done.length, 'session terminée', 'sessions terminées')}</span>
            </Line>
            <Collapse open={doneOpen}>
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
