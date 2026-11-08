import { AnimatePresence, motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import type { MainMessage, Project, Session } from '../../shared/api.ts'
import { api } from '../api'
import { prefetchRepo } from './pages'
import { ConvLine, statusLabel, useProjectName } from './convs'
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
            {snap.main.slice(-6).map((m) => (
              <Appear key={m.id}>
                <MainMsg m={m} />
              </Appear>
            ))}
          </AnimatePresence>
        </div>
        {toSort.length > 0 && (
          <div className="band tone">
            <div className="in label">à ranger</div>
            {toSort.slice(0, 5).map((c) => (
              <SortLine key={c.id} id={c.id} />
            ))}
            {toSort.length > 5 && (
              <Line ch='"' onClick={() => push({ kind: 'conversations' })}>
                <span className="meta">les {toSort.length} conversations à ranger</span>
              </Line>
            )}
          </div>
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

      <Composer placeholder="dis à weevils quoi faire" label="message à l’agent principal" onSend={send} onFocus={() => setExpanded('agent')} />
    </section>
  )
}

function SortLine({ id }: { id: string }) {
  const { snap, push, refresh } = useApp()
  const name = useProjectName()
  const c = snap.conversations.find((x) => x.id === id)
  if (!c) return null
  return (
    <div className="in" style={{ paddingBlock: 8 }}>
      <div className="ellipsis" style={{ fontSize: '1.0625rem' }}>
        <span className="strong">" </span>
        {c.title}
      </div>
      <div className="meta ellipsis">
        {statusLabel(c, name)}
        {c.reason ? ` · ${c.reason}` : ''}
      </div>
      <div className="inline-actions">
        {c.suggestedProjectId && (
          <button className="link" onClick={() => void api.classify(c.id, { projectId: c.suggestedProjectId }).then(refresh)}>
            ranger dans {name(c.suggestedProjectId)}
          </button>
        )}
        <button className="link" onClick={() => push({ kind: 'conversation', id: c.id })}>
          voir / ailleurs…
        </button>
      </div>
    </div>
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
  const choices = m.ask && !m.ask.chosenSessionId ? snap.sessions.filter((s) => s.controllable).slice(0, 8) : []
  const label = (s: Session) => `${s.projectId} · ${s.tool} · ${s.title}`
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
      {choices.map((s) => (
        <Line key={s.id} ch="→" go={null} onClick={() => void api.choose(m.id, s.id).then(refresh)}>
          {label(s)}
        </Line>
      ))}
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

  const summary = [
    active.length ? activity(active) : sessions.length ? 'rien ne tourne' : null,
    att.length ? `${att.length} à toi` : null,
    convCount ? plural(convCount, 'conversation', 'conversations') : null,
    !active.length ? ago(now - project.lastActivityAt) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="band" style={color(colors[project.id] ?? 'p0')} aria-label={`projet ${project.name}`} data-project={project.id}>
      <motion.div className="in head" initial={false} animate={{ minHeight: mode === 'mini' ? 50 : 64, paddingTop: mode === 'mini' ? 0 : 8 }} transition={spring}>
        <button className="head-name" onClick={toggle} aria-expanded={mode === 'open'} aria-controls={`more-${project.id}`}>
          <motion.span className="name" initial={false} animate={{ fontSize: NAME_SIZE[mode] }} transition={spring}>
            {project.name}
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
              {done.slice(0, 12).map((s) => (
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
    </section>
  )
}

// ---------------------------------------------------------------------------
// Bande de fin : réglages et état de la connexion. Elle remplit l'espace jusqu'au rail H24.

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
