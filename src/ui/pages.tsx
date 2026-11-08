import { motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Tool } from '../state/types'
import { useApp, type Page } from './app-context'
import { Collapse, Composer, Line, Messages, spring } from './bits'
import { ago, dur, durLong, plural, status } from './format'

const color = (slot: string) => ({ '--c': `var(--${slot})` }) as CSSProperties

/** Page plein écran dans la couleur du projet. Glisser vers la droite = retour. */
function Shell({
  slot,
  kicker,
  title,
  meta,
  children,
  foot,
}: {
  slot: string
  kicker: string
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
  foot?: ReactNode
}) {
  const { back } = useApp()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  return (
    <motion.div
      className="page"
      style={color(slot)}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={spring}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.9 }}
      dragSnapToOrigin
      onDragEnd={(_, info) => {
        if (info.offset.x > 110 || info.velocity.x > 600) back()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : kicker}
    >
      <div className="page-head band tone">
        <div className="in">
          <button className="back" onClick={back} aria-label={`retour · ${kicker}`}>
            <span aria-hidden>&lt;</span>
            <span className="meta" aria-hidden>
              {kicker}
            </span>
          </button>
          <h1 ref={heading} tabIndex={-1} className="h2" style={{ margin: 0 }}>
            {title}
          </h1>
          {meta && <div className="meta" style={{ marginTop: 4 }}>{meta}</div>}
        </div>
      </div>
      <div className="page-body" data-scroll>
        {children}
        <div className="fill" />
      </div>
      {foot && <div className="page-foot">{foot}</div>}
    </motion.div>
  )
}

/** Garde la fin du fil visible quand un message arrive. */
function useStickToBottom(count: number) {
  const first = useRef(true)
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.page:last-of-type [data-scroll]')
    if (!el) return
    const go = (smooth: boolean) => el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    go(!first.current)
    const t = setTimeout(() => go(!first.current), 420)
    first.current = false
    return () => clearTimeout(t)
  }, [count])
}

export function PageView({ page }: { page: Page }) {
  switch (page.kind) {
    case 'session':
      return <SessionPage id={page.id} />
    case 'conversation':
      return <ConversationPage id={page.id} />
    case 'conversations':
      return <ConversationsPage projectId={page.projectId} />
    case 'files':
      return <FilesPage projectId={page.projectId} />
    case 'file':
      return <FilePage projectId={page.projectId} path={page.path} />
    case 'machine':
      return <MachinePage projectId={page.projectId} />
    case 'new':
      return <NewSessionPage projectId={page.projectId} />
  }
}

function Missing() {
  return (
    <Shell slot="agent" kicker="weevils" title="introuvable">
      <div className="in meta empty">Cet élément n’existe plus (remise à zéro ?).</div>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function SessionPage({ id }: { id: string }) {
  const { state, dispatch, act, now } = useApp()
  const [showSubs, setShowSubs] = useState(true)
  const s = state.sessions.find((x) => x.id === id)
  useStickToBottom(s?.messages.length ?? 0)
  if (!s) return <Missing />
  const project = state.projects.find((p) => p.id === s.projectId)!
  const machine = state.machines.find((m) => m.id === s.machineId)
  const pending = state.interventions.find((i) => i.sessionId === s.id && i.status === 'pending')
  const st = status[s.status]
  const active = s.subagents.filter((a) => a.status === 'working').length
  const done = s.subagents.length - active

  return (
    <Shell
      slot={project.color}
      kicker={project.name}
      title={s.title}
      meta={
        <>
          <span className="strong">
            {s.tool} · {st.ch} {st.label}
          </span>
          {' · '}ouverte depuis {durLong(now - s.openedAt)}
          {s.status === 'working' && s.workStartedAt != null && <> · travaille depuis {durLong(now - s.workStartedAt)}</>}
          <br />
          {s.origin}
          {machine && <> · {machine.name}</>}
        </>
      }
      foot={<Composer placeholder={`écris à ${s.tool}`} label={`message à la session ${s.title}`} onSend={(t) => act.sendToSession(s.id, t)} />}
    >
      {pending && (
        <div className="band invert">
          <div className="in" style={{ paddingTop: 14 }}>
            <div className="small strong">! à toi</div>
            <div className="h2">{pending.title}</div>
            <div className="meta" style={{ paddingBottom: 6 }}>
              {pending.description}
            </div>
          </div>
          {pending.choices.map((c) => (
            <Line key={c.id} ch="→" go={null} onClick={() => dispatch({ type: 'resolve', interventionId: pending.id, choiceId: c.id, at: Date.now() })}>
              {c.label}
            </Line>
          ))}
          <div style={{ height: 8 }} />
        </div>
      )}

      {s.subagents.length > 0 && (
        <div className="band tone">
          <Line
            ch="&"
            go={showSubs ? '−' : '+'}
            onClick={() => setShowSubs((v) => !v)}
            label={`sous-agents : ${active} actifs, ${done} terminés. ${showSubs ? 'replier' : 'déplier'}`}
          >
            <span className="strong">sous-agents</span> · {active} {active > 1 ? 'actifs' : 'actif'} · {done} {done > 1 ? 'terminés' : 'terminé'}
          </Line>
          <Collapse open={showSubs}>
            {s.subagents.map((a) => (
              <div key={a.id} className="in" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBlock: 8 }}>
                <span className="h2" style={{ width: 22, textAlign: 'center', lineHeight: 1.2 }} aria-hidden>
                  {a.status === 'working' ? <span className="spin">*</span> : '✓'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <span className="strong">{a.label}</span> · {a.status === 'working' ? 'travaille' : 'terminé'}
                  </div>
                  <div className="meta">
                    {a.activity} · {dur((a.endedAt ?? now) - a.startedAt)}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ height: 8 }} />
          </Collapse>
        </div>
      )}

      <Messages messages={s.messages} author={s.tool} />
      {s.messages.length === 0 && <div className="in meta empty">Aucun message. Écris le premier en bas.</div>}
    </Shell>
  )
}

function ConversationPage({ id }: { id: string }) {
  const { state, act, now } = useApp()
  const c = state.conversations.find((x) => x.id === id)
  useStickToBottom(c?.messages.length ?? 0)
  if (!c) return <Missing />
  const project = state.projects.find((p) => p.id === c.projectId)
  return (
    <Shell
      slot={project?.color ?? 'agent'}
      kicker={project ? project.name : 'à ranger'}
      title={c.title}
      meta={
        <>
          <span className="strong">{c.source}</span> · conversation fictive · {ago(now - c.updatedAt)}
        </>
      }
      foot={<Composer placeholder={`écris à ${c.source}`} label={`message dans la conversation ${c.title}`} onSend={(t) => act.sendToConversation(c.id, t)} />}
    >
      <Messages messages={c.messages} author={c.source} />
    </Shell>
  )
}

function ConversationsPage({ projectId }: { projectId: string }) {
  const { state, push, now } = useApp()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return <Missing />
  const convs = state.conversations.filter((c) => c.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <Shell slot={project.color} kicker={project.name} title='" conversations' meta="échanges chatgpt et claude rangés dans ce projet">
      {convs.map((c) => (
        <Line key={c.id} ch='"' meta={`${c.source} · ${ago(now - c.updatedAt)}`} onClick={() => push({ kind: 'conversation', id: c.id })}>
          {c.title}
        </Line>
      ))}
      {convs.length === 0 && <div className="in meta empty">Aucune conversation rangée ici pour l’instant.</div>}
    </Shell>
  )
}

function FilesPage({ projectId }: { projectId: string }) {
  const { state, push } = useApp()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project?.repo) return <Missing />
  return (
    <Shell slot={project.color} kicker={project.name} title={`/ ${project.repo.label}`} meta="repo simulé · pas connecté à GitHub">
      {project.repo.files.map((f) => (
        <Line key={f.path} ch="/" onClick={() => push({ kind: 'file', projectId, path: f.path })}>
          {f.path}
        </Line>
      ))}
    </Shell>
  )
}

function FilePage({ projectId, path }: { projectId: string; path: string }) {
  const { state } = useApp()
  const project = state.projects.find((p) => p.id === projectId)
  const file = project?.repo?.files.find((f) => f.path === path)
  if (!project || !file) return <Missing />
  return (
    <Shell slot={project.color} kicker={`${project.name} / fichiers`} title={file.path} meta="contenu fictif">
      <pre className="in code">{file.content}</pre>
    </Shell>
  )
}

function MachinePage({ projectId }: { projectId: string }) {
  const { state, push, now } = useApp()
  const project = state.projects.find((p) => p.id === projectId)
  const machine = state.machines.find((m) => state.sessions.some((s) => s.projectId === projectId && s.machineId === m.id))
  if (!project || !machine) return <Missing />
  const sessions = state.sessions.filter((s) => s.machineId === machine.id)
  return (
    <Shell slot={project.color} kicker={project.name} title={`@ ${machine.name}`} meta={machine.note}>
      <div className="in label">{plural(sessions.length, 'session', 'sessions')} sur cette machine</div>
      {sessions.map((s) => {
        const p = state.projects.find((x) => x.id === s.projectId)
        return (
          <Line
            key={s.id}
            ch={status[s.status].ch}
            meta={`${status[s.status].label} · ouverte depuis ${durLong(now - s.openedAt)}`}
            onClick={() => push({ kind: 'session', id: s.id })}
          >
            <span className="strong">{p?.name}</span> · {s.tool} · {s.title}
          </Line>
        )
      })}
    </Shell>
  )
}

function NewSessionPage({ projectId }: { projectId: string }) {
  const { state, act, replace } = useApp()
  const [tool, setTool] = useState<Tool>('claude')
  const [title, setTitle] = useState('')
  const created = useRef(false)
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return <Missing />
  const create = (text: string) => {
    if (created.current) return
    created.current = true
    const id = act.createSession(projectId, tool, title, text)
    replace({ kind: 'session', id })
  }
  return (
    <Shell
      slot={project.color}
      kicker={project.name}
      title="+ nouvelle session"
      meta="démo : la session est créée localement, rien n’est lancé"
      foot={<Composer placeholder="premier message" label="premier message de la session" onSend={create} />}
    >
      <div className="in label">outil</div>
      {(['claude', 'codex'] as Tool[]).map((t) => (
        <Line key={t} className={tool === t ? 'invert' : ''} ch={tool === t ? '>' : ' '} go={null} onClick={() => setTool(t)} label={`${t}${tool === t ? ', choisi' : ''}`}>
          {t}
        </Line>
      ))}
      <div className="in label">intitulé (facultatif)</div>
      <div className="band tone composer">
        <div className="in">
          <span className="prompt" aria-hidden>
            #
          </span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. refaire la page d’accueil" aria-label="intitulé de la session" />
        </div>
      </div>
      <Line ch="+" go={null} meta="ou écris directement le premier message en bas" onClick={() => create('')}>
        ouvrir sans message
      </Line>
    </Shell>
  )
}
