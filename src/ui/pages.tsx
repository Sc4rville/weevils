import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Message, SessionDetail, Tool } from '../../shared/api.ts'
import { api, type FileContent } from '../api'
import { useApp, type Page } from './app-context'
import { Collapse, Composer, Line, Messages, StatusChar, spring } from './bits'
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
          {meta && (
            <div className="meta" style={{ marginTop: 4 }}>
              {meta}
            </div>
          )}
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
    if (!el || count === 0) return
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
    case 'files':
      return <FilesPage projectId={page.projectId} repo={page.repo} dir={page.dir} />
    case 'file':
      return <FilePage projectId={page.projectId} repo={page.repo} path={page.path} />
    case 'machine':
      return <MachinePage projectId={page.projectId} />
    case 'new':
      return <NewSessionPage projectId={page.projectId} />
  }
}

function Missing({ text = 'Cet élément n’existe plus.' }: { text?: string }) {
  return (
    <Shell slot="agent" kicker="weevils" title="introuvable">
      <div className="in meta empty">{text}</div>
    </Shell>
  )
}

function ErrorBand({ text }: { text: string }) {
  return (
    <div className="band invert" role="alert">
      <div className="in meta" style={{ paddingBlock: 12 }}>
        ! {text}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session : le fil, l'écran du terminal, les touches.

const KEYS: [string, string, string][] = [
  ['1', '1', 'choix 1'],
  ['2', '2', 'choix 2'],
  ['3', '3', 'choix 3'],
  ['up', '↑', 'flèche haut'],
  ['down', '↓', 'flèche bas'],
  ['enter', '⏎', 'entrée'],
  ['esc', 'esc', 'échap'],
  ['tab', 'tab', 'tabulation'],
]

function Keys({ id, onError }: { id: string; onError: (m: string) => void }) {
  return (
    <div className="in keys">
      {KEYS.map(([k, label, aria]) => (
        <button key={k} className="key" aria-label={aria} onClick={() => void api.key(id, k).catch((e) => onError((e as Error).message))}>
          {label}
        </button>
      ))}
    </div>
  )
}

function SessionPage({ id }: { id: string }) {
  const { snap, now, replace, colors } = useApp()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<Message[]>([])
  const [screenText, setScreenText] = useState<string | null>(null)
  const [showScreen, setShowScreen] = useState<boolean | null>(null)
  const [showSubs, setShowSubs] = useState(true)

  // Le détail suit chaque nouvelle version annoncée par le serveur.
  useEffect(() => {
    let off = false
    api
      .session(id)
      .then((d) => {
        if (off) return
        setDetail(d)
        setMissing(false)
        if (d.session.id !== id) replace({ kind: 'session', id: d.session.id })
      })
      .catch(() => !off && setMissing(true))
    return () => {
      off = true
    }
  }, [id, snap.version, replace])

  const s = snap.sessions.find((x) => x.id === id) ?? detail?.session
  const screenOpen = showScreen ?? s?.status === 'needs_user'

  // Écran du terminal : rafraîchi tant qu'il est affiché.
  useEffect(() => {
    if (!s?.hasScreen || !screenOpen) return
    let off = false
    const tick = () =>
      api
        .screen(id)
        .then((r) => !off && setScreenText(r.screen))
        .catch(() => undefined)
    tick()
    const t = setInterval(tick, 1500)
    return () => {
      off = true
      clearInterval(t)
    }
  }, [id, s?.hasScreen, screenOpen])

  const messages = useMemo(() => {
    const real = detail?.messages ?? []
    const seen = new Set(real.filter((m) => m.role === 'user').map((m) => m.text.trim()))
    return [...real, ...pending.filter((p) => !seen.has(p.text.trim()))]
  }, [detail, pending])
  useStickToBottom(messages.length)

  if (!s) return missing ? <Missing text="Session introuvable : elle a peut-être plus de trois jours." /> : <Shell slot="agent" kicker="weevils" title="…">{null}</Shell>

  const project = snap.projects.find((p) => p.id === s.projectId)
  const st = status[s.status]
  const active = s.subagents.filter((a) => a.status === 'working').length

  const send = async (text: string) => {
    setErr(null)
    const tmp: Message = { id: `pending-${Date.now()}`, role: 'user', text, at: Date.now() }
    setPending((p) => [...p, tmp])
    try {
      const r = await api.send(s.id, text)
      if (r.id !== id) replace({ kind: 'session', id: r.id })
    } catch (e) {
      setPending((p) => p.filter((x) => x.id !== tmp.id))
      setErr((e as Error).message)
      throw e
    }
  }

  return (
    <Shell
      slot={colors[s.projectId] ?? 'agent'}
      kicker={project?.name ?? s.projectId}
      title={s.title}
      meta={
        <>
          <span className="strong">
            {s.tool} · <StatusChar s={s.status} /> {st.label}
          </span>
          {' · '}ouverte depuis {durLong(now - s.openedAt)}
          {s.status === 'working' && s.workStartedAt != null && <> · travaille depuis {durLong(now - s.workStartedAt)}</>}
          <br />
          {s.repo ?? s.cwd}
          {s.branch && <> · {s.branch}</>} · {s.origin === 'weevils' ? 'pilotée par weevils' : s.origin}
        </>
      }
      foot={
        <Composer
          placeholder={s.controllable ? (s.live ? `écris à ${s.tool}` : `reprendre avec ${s.tool}`) : 'lecture seule'}
          label={`message à la session ${s.title}`}
          onSend={send}
          disabled={!s.controllable}
        />
      }
    >
      {err && <ErrorBand text={err} />}

      {s.status === 'needs_user' && (
        <div className="band invert">
          <div className="in" style={{ paddingBlock: 14 }}>
            <div className="small strong">! à toi</div>
            <div className="h2">{s.attention ?? 'la session attend ta réponse'}</div>
            {!s.hasScreen && <div className="meta">Réponds dans le terminal où elle tourne.</div>}
          </div>
        </div>
      )}

      {s.hasScreen && (
        <div className={`band ${s.status === 'needs_user' ? 'invert' : 'tone'}`}>
          <Line ch=">_" go={screenOpen ? '−' : '+'} onClick={() => setShowScreen(!screenOpen)} label={screenOpen ? 'masquer l’écran du terminal' : 'voir l’écran du terminal'}>
            <span className="strong">écran du terminal</span>
          </Line>
          <Collapse open={screenOpen}>
            <pre className="screen">{screenText ?? 'lecture de l’écran…'}</pre>
            <Keys id={s.id} onError={setErr} />
            <div style={{ height: 10 }} />
          </Collapse>
        </div>
      )}

      {!s.controllable && (
        <div className="band tone">
          <div className="in meta" style={{ paddingBlock: 12 }}>
            Ouverte dans un terminal que weevils ne pilote pas : tu la lis ici, mais pour lui écrire, lance tes sessions avec <span className="strong">wv</span>. Une fois
            fermée, weevils pourra la reprendre.
          </div>
        </div>
      )}

      {s.subagents.length > 0 && (
        <div className="band tone">
          <Line ch="&" go={showSubs ? '−' : '+'} onClick={() => setShowSubs((v) => !v)} label={`sous-agents : ${active} actifs`}>
            <span className="strong">sous-agents</span> · {active} {active > 1 ? 'actifs' : 'actif'} · {s.subagents.length - active} terminés
          </Line>
          <Collapse open={showSubs}>
            {s.subagents.map((a) => (
              <div key={a.id} className="in" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBlock: 8 }}>
                <span className="h2" style={{ width: 22, textAlign: 'center', lineHeight: 1.2 }} aria-hidden>
                  {a.status === 'working' ? <span className="spin">*</span> : '✓'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis">
                    <span className="strong">{a.activity}</span>
                  </div>
                  <div className="meta">
                    {a.label} · {a.status === 'working' ? 'travaille' : 'terminé'} · {dur((a.endedAt ?? now) - a.startedAt)}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ height: 8 }} />
          </Collapse>
        </div>
      )}

      <Messages messages={messages} author={s.tool} />
      {detail && messages.length === 0 && <div className="in meta empty">Pas encore de message. La session démarre.</div>}
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Explorateur de fichiers : un dossier par page, la liste du repo est gardée en cache.

const fileLists = new Map<string, Promise<string[]>>()
const fileContents = new Map<string, Promise<FileContent>>()
const listFiles = (repo: string) => {
  if (!fileLists.has(repo)) fileLists.set(repo, api.files(repo).then((r) => r.files).catch((e) => (fileLists.delete(repo), Promise.reject(e))))
  return fileLists.get(repo)!
}
const readFile = (repo: string, path: string) => {
  const k = `${repo}\u0000${path}`
  if (!fileContents.has(k)) fileContents.set(k, api.file(repo, path).catch((e) => (fileContents.delete(k), Promise.reject(e))))
  return fileContents.get(k)!
}
/** Préchargement discret (au survol / à l'ouverture d'une bande). */
export const prefetchRepo = (repo: string) => void listFiles(repo).catch(() => undefined)

function FilesPage({ projectId, repo, dir = '' }: { projectId: string; repo?: string; dir?: string }) {
  const { snap, push, colors } = useApp()
  const project = snap.projects.find((p) => p.id === projectId)
  const theRepo = repo ?? (project?.repos.length === 1 ? project.repos[0] : undefined)
  const [files, setFiles] = useState<string[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!theRepo) return
    let off = false
    listFiles(theRepo)
      .then((f) => !off && setFiles(f))
      .catch((e) => !off && setErr((e as Error).message))
    return () => {
      off = true
    }
  }, [theRepo])

  const entries = useMemo(() => {
    if (!files) return null
    const prefix = dir ? `${dir}/` : ''
    const folders = new Map<string, number>()
    const leaves: string[] = []
    for (const f of files) {
      if (!f.startsWith(prefix)) continue
      const rest = f.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash >= 0) folders.set(rest.slice(0, slash), (folders.get(rest.slice(0, slash)) ?? 0) + 1)
      else leaves.push(rest)
    }
    return { folders: [...folders].sort((a, b) => a[0].localeCompare(b[0])), leaves: leaves.sort((a, b) => a.localeCompare(b)) }
  }, [files, dir])

  if (!project) return <Missing />
  const slot = colors[projectId] ?? 'agent'

  if (!theRepo) {
    return (
      <Shell slot={slot} kicker={project.name} title="/ repos" meta={plural(project.repos.length, 'repo', 'repos')}>
        {project.repos.map((r) => (
          <Line key={r} ch="/" onClick={() => push({ kind: 'files', projectId, repo: r })}>
            {r}
          </Line>
        ))}
      </Shell>
    )
  }

  return (
    <Shell slot={slot} kicker={dir ? `${theRepo}/${dir.split('/').slice(0, -1).join('/')}` : project.name} title={dir ? `/${dir.split('/').pop()}` : `/ ${theRepo}`} meta={files ? plural(files.length, 'fichier', 'fichiers') : 'lecture du repo…'}>
      {err && <ErrorBand text={err} />}
      {entries?.folders.map(([name, count]) => (
        <Line key={name} ch="/" meta={plural(count, 'fichier', 'fichiers')} onClick={() => push({ kind: 'files', projectId, repo: theRepo, dir: dir ? `${dir}/${name}` : name })}>
          <span className="strong">{name}/</span>
        </Line>
      ))}
      {entries?.leaves.slice(0, 500).map((name) => {
        const path = dir ? `${dir}/${name}` : name
        return (
          <Line key={name} ch="·" onClick={() => push({ kind: 'file', projectId, repo: theRepo, path })}>
            {name}
          </Line>
        )
      })}
      {entries && entries.folders.length + entries.leaves.length === 0 && <div className="in meta empty">Dossier vide.</div>}
    </Shell>
  )
}

const kb = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`)

function FilePage({ projectId, repo, path }: { projectId: string; repo: string; path: string }) {
  const { colors } = useApp()
  const [file, setFile] = useState<FileContent | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    readFile(repo, path)
      .then((f) => !off && setFile(f))
      .catch((e) => !off && setErr((e as Error).message))
    return () => {
      off = true
    }
  }, [repo, path])
  const prose = /\.(md|markdown|txt)$/i.test(path)
  return (
    <Shell
      slot={colors[projectId] ?? 'agent'}
      kicker={`${repo}/${path.split('/').slice(0, -1).join('/')}`}
      title={path.split('/').pop()}
      meta={file ? `${kb(file.size)}${file.truncated ? ' · tronqué' : ''}` : 'lecture…'}
    >
      {err && <ErrorBand text={err} />}
      {file?.binary && <div className="in meta empty">Fichier binaire : pas d’aperçu.</div>}
      {file && !file.binary && <pre className={`in ${prose ? 'code' : 'code mono'}`}>{file.content}</pre>}
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function MachinePage({ projectId }: { projectId: string }) {
  const { snap, push, now, colors } = useApp()
  const machine = snap.machines[0]
  if (!machine) return <Missing />
  const live = snap.sessions.filter((s) => s.status !== 'done')
  return (
    <Shell slot={colors[projectId] ?? 'agent'} kicker={snap.projects.find((p) => p.id === projectId)?.name ?? 'weevils'} title={`@ ${machine.name}`} meta={machine.note}>
      <div className="in label">{plural(live.length, 'session ouverte', 'sessions ouvertes')}</div>
      {live.map((s) => (
        <Line key={s.id} ch={<StatusChar s={s.status} />} meta={`${status[s.status].label} · ${s.origin} · ${ago(now - s.lastActivityAt)}`} onClick={() => push({ kind: 'session', id: s.id })}>
          <span className="strong">{s.projectId}</span> · {s.tool} · {s.title}
        </Line>
      ))}
      {live.length === 0 && <div className="in meta empty">Aucune session ouverte sur cette machine.</div>}
      <div className="in label">depuis un terminal</div>
      <div className="in meta" style={{ paddingBottom: 16 }}>
        <span className="strong">wv</span> lance claude dans le dossier courant, <span className="strong">wv codex</span> lance codex, <span className="strong">wv ls</span> liste
        les sessions, <span className="strong">wv a</span> s’y rattache. weevils les voit et les pilote.
      </div>
    </Shell>
  )
}

function NewSessionPage({ projectId }: { projectId: string }) {
  const { snap, replace, colors } = useApp()
  const project = snap.projects.find((p) => p.id === projectId)
  const [tool, setTool] = useState<Tool>('claude')
  const [repo, setRepo] = useState<string | undefined>(project?.repos[0])
  const [err, setErr] = useState<string | null>(null)
  const created = useRef(false)
  if (!project) return <Missing />
  const create = async (text: string) => {
    if (created.current) return
    created.current = true
    setErr(null)
    try {
      const r = await api.create({ projectId, repo, tool, text })
      replace({ kind: 'session', id: r.id })
    } catch (e) {
      created.current = false
      setErr((e as Error).message)
      throw e
    }
  }
  return (
    <Shell
      slot={colors[projectId] ?? 'agent'}
      kicker={project.name}
      title="+ nouvelle session"
      meta="lancée sur le VPS dans une session wv, pilotable d’ici et depuis un terminal (wv a)"
      foot={<Composer placeholder="premier message" label="premier message de la session" onSend={create} />}
    >
      {err && <ErrorBand text={err} />}
      <div className="in label">outil</div>
      {(['claude', 'codex'] as Tool[]).map((t) => (
        <Line key={t} className={tool === t ? 'invert' : ''} ch={tool === t ? '>' : ' '} go={null} onClick={() => setTool(t)} label={`${t}${tool === t ? ', choisi' : ''}`}>
          {t}
        </Line>
      ))}
      {project.repos.length > 1 && (
        <>
          <div className="in label">repo</div>
          {project.repos.map((r) => (
            <Line key={r} className={repo === r ? 'invert' : ''} ch={repo === r ? '>' : '/'} go={null} onClick={() => setRepo(r)}>
              {r}
            </Line>
          ))}
        </>
      )}
      <Line ch="+" go={null} meta="ou écris directement le premier message en bas" onClick={() => void create('').catch(() => undefined)}>
        ouvrir sans message
      </Line>
    </Shell>
  )
}
