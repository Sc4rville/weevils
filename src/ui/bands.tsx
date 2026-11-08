import { AnimatePresence, motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import { globalStats, h24Stats, projectStats, sessionLabel } from '../state/store'
import type { Conversation, MainMessage, Project } from '../state/types'
import { useApp } from './app-context'
import { Appear, Collapse, Composer, Line, SessionRow, spring } from './bits'
import { ago, plural } from './format'

const color = (slot: string) => ({ '--c': `var(--${slot})` }) as CSSProperties

/** Taille du nom selon l'état de la bande. */
const NAME_SIZE = { open: '3rem', normal: '2.125rem', mini: '1.375rem' } as const

// ---------------------------------------------------------------------------
// Agent principal : la bande du haut, l'endroit central.

export function AgentBand() {
  const { state, expanded, setExpanded, act } = useApp()
  const open = expanded === 'agent'
  const g = globalStats(state)
  const h = h24Stats(state)
  const summary = [
    `${g.working} ${g.working > 1 ? 'travaillent' : 'travaille'}`,
    g.waiting ? `${g.waiting} à toi` : null,
    g.toSort ? `${g.toSort} à ranger` : null,
    `h24 ${h.running} en cours`,
  ]
    .filter(Boolean)
    .join(' · ')
  const sorting = state.conversations.filter((c) => c.suggestion)

  return (
    <section className="band agent" style={color('agent')} aria-label="agent principal">
      <div className="in head">
        <button className="head-name" onClick={() => setExpanded(open ? null : 'agent')} aria-expanded={open} aria-controls="agent-body">
          <motion.span className="name" initial={false} animate={{ fontSize: expanded && !open ? NAME_SIZE.mini : NAME_SIZE.normal }} transition={spring}>
            weevils
          </motion.span>
        </button>
        <span className="chars small strong" aria-label="mode démo, données fictives">
          démo
        </span>
      </div>
      <div className="in meta summary">{summary}</div>

      <Collapse open={open} id="agent-body">
        <div aria-live="polite">
          <AnimatePresence initial={false}>
            {state.main.slice(-6).map((m) => (
              <Appear key={m.id}>
                <MainMsg m={m} />
              </Appear>
            ))}
          </AnimatePresence>
        </div>
        {sorting.length > 0 && (
          <div className="band tone">
            <div className="in label">à ranger</div>
            {sorting.map((c) => (
              <SortLine key={c.id} c={c} />
            ))}
          </div>
        )}
        <div className="in meta" style={{ paddingBlock: 8 }}>
          essaie :{' '}
          <span className="inline-actions" style={{ display: 'inline-flex' }}>
            {['reprends le crm', 'ouvre claude lws', 'on avance ?'].map((t) => (
              <button key={t} className="link" onClick={() => act.sendMain(t)}>
                « {t} »
              </button>
            ))}
          </span>
        </div>
      </Collapse>

      <Composer placeholder="dis à weevils quoi faire" label="message à l’agent principal" onSend={act.sendMain} onFocus={() => setExpanded('agent')} />
    </section>
  )
}

function MainMsg({ m }: { m: MainMessage }) {
  const { state, push, act } = useApp()
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
  const choices = m.ask && !m.ask.chosenSessionId ? state.sessions.filter((s) => s.status !== 'done') : []
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
        {m.ask?.chosenSessionId && <div className="meta">destination choisie ✓</div>}
      </div>
      {choices.map((s) => (
        <Line key={s.id} ch="→" go={null} onClick={() => act.chooseMain(m.id, s.id)}>
          {sessionLabel(state, s.id)}
        </Line>
      ))}
    </div>
  )
}

function SortLine({ c }: { c: Conversation }) {
  const { state, dispatch } = useApp()
  const [choosing, setChoosing] = useState(false)
  const name = (id?: string | null) => state.projects.find((p) => p.id === id)?.name ?? '?'
  const classify = (projectId: string) => {
    dispatch({ type: 'classify', conversationId: c.id, projectId })
    setChoosing(false)
  }
  const pending = c.suggestion === 'pending'
  return (
    <div>
      <div className="in" style={{ paddingBlock: 8 }}>
        <div className="ellipsis" style={{ fontSize: '1.0625rem' }}>
          <span className="strong">" </span>
          {c.title}
        </div>
        <div className="meta">
          {pending ? `${c.source} · weevils propose ${name(c.suggestedProjectId)} : ${c.suggestionReason}` : `${c.source} · rangée dans ${name(c.projectId)} ✓`}
        </div>
        <div className="inline-actions">
          {pending && (
            <button className="link" onClick={() => classify(c.suggestedProjectId!)}>
              ranger dans {name(c.suggestedProjectId)}
            </button>
          )}
          <button className="link" onClick={() => setChoosing((v) => !v)} aria-expanded={choosing}>
            {pending ? 'ailleurs…' : 'changer'}
          </button>
        </div>
      </div>
      <Collapse open={choosing}>
        {state.projects
          .filter((p) => p.id !== c.projectId)
          .map((p) => (
            <Line key={p.id} ch="→" go={null} onClick={() => classify(p.id)} label={`ranger dans ${p.name}`}>
              {p.name}
            </Line>
          ))}
      </Collapse>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bande projet : nom fort, caractères-icônes, sessions. Elle s'ouvre, les autres se replient.

export function ProjectBand({ project }: { project: Project }) {
  const { state, expanded, setExpanded, push, now, setH24Open } = useApp()
  const mode = expanded === null ? 'normal' : expanded === project.id ? 'open' : 'mini'
  const stats = projectStats(state, project.id)
  const sessions = state.sessions.filter((s) => s.projectId === project.id)
  const pending = state.interventions.filter((i) => i.projectId === project.id && i.status === 'pending')
  const convs = state.conversations.filter((c) => c.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt)
  const h24 = state.h24.filter((a) => a.projectId === project.id)
  const machine = state.machines.find((m) => sessions.some((s) => s.machineId === m.id))
  const toggle = () => setExpanded(mode === 'open' ? null : project.id)

  const summary = [
    plural(stats.sessions, 'session', 'sessions'),
    stats.working ? `${stats.working} ${stats.working > 1 ? 'travaillent' : 'travaille'}` : null,
    stats.pending ? `${stats.pending} à toi` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="band" style={color(project.color)} aria-label={`projet ${project.name}`} data-project={project.id}>
      {/* Taille adaptative : la bande ouverte grossit, les autres deviennent de fines lanières. Rien ne passe derrière. */}
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
            {project.repo && (
              <button className="ch" aria-label={`fichiers de ${project.name}`} onClick={() => push({ kind: 'files', projectId: project.id })}>
                /
              </button>
            )}
            {machine && (
              <button className="ch" aria-label={`machine de ${project.name}`} onClick={() => push({ kind: 'machine', projectId: project.id })}>
                @
              </button>
            )}
            <button
              className={`ch ${stats.pending ? '' : 'off'}`}
              disabled={!stats.pending}
              aria-label={stats.pending ? `${plural(stats.pending, 'action', 'actions')} à traiter dans ${project.name}` : `rien à traiter dans ${project.name}`}
              onClick={() => pending[0] && push({ kind: 'session', id: pending[0].sessionId })}
            >
              <span>
                !{stats.pending > 0 && <sup>{stats.pending}</sup>}
              </span>
            </button>
            <button className="ch" aria-label={`conversations de ${project.name}`} onClick={() => push({ kind: 'conversations', projectId: project.id })}>
              "
            </button>
            <button className="ch" aria-label={`nouvelle session dans ${project.name}`} onClick={() => push({ kind: 'new', projectId: project.id })}>
              +
            </button>
          </div>
        )}
      </motion.div>

      <Collapse open={mode !== 'mini'}>
        {project.kind === 'invented' && (
          <div className="in meta" style={{ paddingBottom: 6 }}>
            catégorie inventée par weevils · aucun repo
          </div>
        )}
        <AnimatePresence initial={false}>
          {sessions.map((s) => (
            <Appear key={s.id}>
              <SessionRow session={s} />
            </Appear>
          ))}
        </AnimatePresence>
        {sessions.length === 0 && <div className="in meta empty">aucune session · + pour en ouvrir une</div>}
        <div style={{ height: 12 }} />
      </Collapse>

      <Collapse open={mode === 'open'} id={`more-${project.id}`}>
        {pending.map((i) => (
          <Line key={i.id} className="invert" ch="!" meta="la session attend ta décision" onClick={() => push({ kind: 'session', id: i.sessionId })}>
            {i.title}
          </Line>
        ))}
        <div className="band tone">
          <div className="in label">conversations</div>
          {convs.map((c) => (
            <Line key={c.id} ch='"' meta={`${c.source} · ${ago(now - c.updatedAt)}`} onClick={() => push({ kind: 'conversation', id: c.id })}>
              {c.title}
            </Line>
          ))}
          {convs.length === 0 && <div className="in meta empty">aucune conversation rangée ici</div>}

          {(project.repo || machine) && <div className="in label">où ça vit</div>}
          {project.repo && (
            <Line ch="/" meta={`${plural(project.repo.files.length, 'fichier', 'fichiers')} · repo simulé`} onClick={() => push({ kind: 'files', projectId: project.id })}>
              {project.repo.label}
            </Line>
          )}
          {machine && (
            <Line ch="@" meta={plural(state.sessions.filter((s) => s.machineId === machine.id).length, 'session', 'sessions')} onClick={() => push({ kind: 'machine', projectId: project.id })}>
              {machine.name}
            </Line>
          )}

          {h24.length > 0 && <div className="in label">h24</div>}
          {h24.map((a) => (
            <Line
              key={a.id}
              ch={a.runState === 'running' ? <span className="spin">*</span> : a.runState === 'paused' ? '||' : '_'}
              meta={a.runState === 'running' ? 'en cours' : a.runState === 'paused' ? 'en pause' : `en veille · ${a.schedule}`}
              onClick={() => setH24Open(true)}
              go="↓"
            >
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
// Démo : dernière bande, elle remplit l'espace jusqu'au rail H24.

export function DemoBand() {
  const { state, dispatch, act } = useApp()
  const fired = state.firedEvents.includes('terminal-arrival-01')
  const dark = state.theme === 'dark'
  return (
    <section className="band demo" style={color('demo')} aria-label="démo">
      <div className="in head">
        <h2 className="h2" style={{ margin: 0 }}>
          démo
        </h2>
      </div>
      <Line ch="~" meta={`passer en ${dark ? 'clair' : 'sombre'}`} go={null} onClick={() => dispatch({ type: 'theme', theme: dark ? 'light' : 'dark' })}>
        thème {dark ? 'sombre' : 'clair'}
      </Line>
      <Line
        ch=">"
        meta={fired ? 'déjà arrivée dans lws · remise à zéro pour rejouer' : 'une session codex arrive dans lws'}
        go={null}
        disabled={fired}
        onClick={act.fireTerminal}
      >
        simuler une session ouverte depuis le terminal
      </Line>
      <Line ch="0" meta="revenir au scénario de départ" go={null} onClick={act.reset}>
        remise à zéro
      </Line>
      <div className="in meta" style={{ paddingBlock: 14 }}>
        Tout est fictif : aucune connexion à GitHub, au VPS, à Claude ni à ChatGPT.
      </div>
    </section>
  )
}
