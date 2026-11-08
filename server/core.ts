// Le cœur de weevilsd : transcripts + hooks + panes zellij → sessions, projets, H24, agent principal.

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { H24Activity, MainMessage, Project, Session, SessionDetail, Snapshot, Tool } from '../shared/api.ts'
import { CLAUDE_DIR, CODEX_DIR, DATA_DIR, HOME, LOGS_DIR, MACHINE, PROJECTS_DIR, RECENT_MS, STALE_MS } from './config.ts'
import { familyOf, place } from './projects.ts'
import { TranscriptStore, lastMessageOf, titleOf } from './transcripts.ts'
import type { Transcript } from './transcripts.ts'
import type { WvSession } from './mux.ts'
import { attentionFromScreen, capture, listWv, sendKey, sendText, setOpt, spawnWv } from './mux.ts'

interface HookState {
  event: string
  at: number
  message?: string
  pid?: number
}

/** Session tmux wv-* vue au dernier passage, avec ce qu'on lit à son écran. */
interface ManagedPane extends WvSession {
  screenAttention?: string
}

interface Persisted {
  main: MainMessage[]
  hooks?: [string, HookState][]
}

const STATE_FILE = path.join(DATA_DIR, 'state.json')

const pidAlive = (pid?: number) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Remonte les parents d'un hook jusqu'au processus claude. */
export function findClaudePid(start: number): number | undefined {
  let pid = start
  for (let i = 0; i < 8 && pid > 1; i++) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      if (/(^|\/|\0)claude(\0|$)/.test(cmd) || cmd.includes('claude-code') || /\0claude\0/.test(`\0${cmd}`)) return pid
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
    } catch {
      return undefined
    }
  }
  return undefined
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export class Weevils {
  store = new TranscriptStore(CLAUDE_DIR, CODEX_DIR, RECENT_MS)
  hooks = new Map<string, HookState>()
  panes: ManagedPane[] = []
  main: MainMessage[] = []
  h24: H24Activity[] = []
  version = 1
  private listeners = new Set<() => void>()
  private bumpTimer: NodeJS.Timeout | null = null
  private snap: Snapshot | null = null
  private persistTimer: NodeJS.Timeout | null = null

  constructor() {
    try {
      const p = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Persisted
      this.main = p.main ?? []
      this.hooks = new Map(p.hooks ?? [])
    } catch {
      /* premier démarrage */
    }
    if (!this.main.length) {
      this.main.push({
        id: 'hello',
        role: 'assistant',
        text: 'Je range tes sessions par projet. Dis-moi par exemple « reprends lws » ou « ouvre claude weevils » ; si je ne sais pas où envoyer, je te demande.',
        at: Date.now(),
      })
    }
  }

  // ---------------------------------------------------------------- boucle

  start() {
    this.store.scan(Date.now())
    this.refreshH24()
    setInterval(() => {
      if (this.store.scan(Date.now())) this.bump()
      this.linkCodexPanes()
    }, 1500)
    setInterval(() => void this.watchPanes(), 2500)
    setInterval(() => this.refreshH24(), 10_000)
    // Les durées et états « périmés » évoluent avec le temps.
    setInterval(() => this.bump(), 30_000)
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  bump() {
    this.snap = null
    if (this.bumpTimer) return
    this.bumpTimer = setTimeout(() => {
      this.bumpTimer = null
      this.version++
      this.snap = null
      for (const fn of this.listeners) fn()
    }, 200)
  }

  private persist() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      // Les hooks des trois derniers jours suffisent (pid des sessions encore ouvertes).
      const hooks = [...this.hooks].filter(([, h]) => Date.now() - h.at < RECENT_MS)
      const data: Persisted = { main: this.main.slice(-60), hooks }
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 1))
    } catch {
      /* disque plein ? on continue en mémoire */
    }
  }

  // ---------------------------------------------------------------- hooks Claude Code

  hook(body: any, pidHeader?: string) {
    const id = body?.session_id
    if (!id) return
    const prev = this.hooks.get(id)
    const pid = pidHeader ? (findClaudePid(Number(pidHeader)) ?? prev?.pid) : prev?.pid
    this.hooks.set(id, { event: body.hook_event_name ?? 'unknown', at: Date.now(), message: body.message, pid })
    this.bump()
    // Écriture groupée : PostToolUse peut tomber plusieurs fois par seconde.
    if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null
        this.persist()
      }, 2000)
    }
  }

  // ---------------------------------------------------------------- panes pilotées

  /** tmux est le registre : on relit les sessions wv-* et leur écran. */
  private async watchPanes() {
    const found = await listWv()
    const next: ManagedPane[] = []
    for (const p of found) {
      const prev = this.panes.find((x) => x.name === p.name)
      let screenAttention = prev?.screenAttention
      try {
        screenAttention = attentionFromScreen(await capture(p.name))
      } catch {
        /* écran illisible un instant */
      }
      next.push({ ...p, sessionId: p.sessionId ?? prev?.sessionId, screenAttention })
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.panes)
    this.panes = next
    if (changed) this.bump()
  }

  /** Codex ne permet pas de choisir l'identifiant : on relie la pane au transcript qui apparaît dans le même dossier. */
  private linkCodexPanes() {
    for (const p of this.panes) {
      if (p.sessionId || p.tool !== 'codex') continue
      const taken = new Set(this.panes.map((x) => x.sessionId).filter(Boolean))
      const t = this.store
        .all()
        .filter((x) => x.tool === 'codex' && x.cwd === p.cwd && x.openedAt >= p.createdAt - 15_000 && !taken.has(x.id))
        .sort((a, b) => a.openedAt - b.openedAt)[0]
      if (t) {
        p.sessionId = t.id
        void setOpt(p.name, '@wv_session_id', t.id).catch(() => undefined)
        this.bump()
      }
    }
  }

  private paneFor(id: string) {
    return this.panes.find((p) => p.sessionId === id) ?? this.panes.find((p) => p.name === id)
  }

  // ---------------------------------------------------------------- sessions

  private toSession(t: Transcript, now: number): Session {
    const where = place(t.cwd, PROJECTS_DIR)
    const pane = this.paneFor(t.id)
    const hook = this.hooks.get(t.id)
    const hookAlive = hook?.pid ? pidAlive(hook.pid) : undefined
    const live = !!pane || hookAlive === true || (hookAlive === undefined && now - t.lastActivityAt < STALE_MS && t.originator !== 'codex_exec')

    let status: Session['status'] = 'idle'
    let attention: string | undefined
    if (!live || hook?.event === 'SessionEnd') status = 'done'
    else if (pane?.screenAttention) {
      status = 'needs_user'
      attention = pane.screenAttention
    } else if (hook?.event === 'Notification' && hook.at >= t.lastActivityAt - 2000 && !/waiting for your input/i.test(hook.message ?? '')) {
      status = 'needs_user'
      attention = hook.message
    } else if (hook && hookAlive && hook.at >= t.lastActivityAt - 2000 && ['UserPromptSubmit', 'PostToolUse'].includes(hook.event)) status = 'working'
    else if (hook?.event === 'Stop' && hook.at >= t.lastActivityAt - 2000) status = 'idle'
    else if (t.phase === 'working' && now - t.lastActivityAt < 10 * 60_000) status = 'working'

    // Ouverte dans un terminal que weevils ne pilote pas : on ne peut ni lui écrire ni la reprendre sans risque.
    const unmanagedLive = live && !pane
    return {
      id: t.id,
      projectId: where.projectId,
      repo: where.repo,
      machineId: MACHINE.id,
      tool: t.tool,
      title: titleOf(t),
      status,
      attention,
      cwd: t.cwd,
      branch: t.branch,
      openedAt: t.openedAt,
      lastActivityAt: t.lastActivityAt,
      workStartedAt: status === 'working' ? (t.workStartedAt ?? t.lastActivityAt) : null,
      origin: pane ? 'weevils' : t.originator === 'codex_exec' ? 'headless' : 'terminal',
      controllable: !unmanagedLive,
      live,
      hasScreen: !!pane,
      subagents: t.subagents,
      lastMessage: lastMessageOf(t),
      messageCount: t.messages.length,
    }
  }

  /** Pane lancée par weevils dont le transcript n'existe pas encore. */
  private placeholder(p: ManagedPane, now: number): Session {
    const where = place(p.cwd, PROJECTS_DIR)
    return {
      id: p.sessionId ?? p.name,
      projectId: where.projectId,
      repo: where.repo,
      machineId: MACHINE.id,
      tool: p.tool,
      title: p.title,
      status: p.screenAttention ? 'needs_user' : 'working',
      attention: p.screenAttention,
      cwd: p.cwd,
      openedAt: p.createdAt,
      lastActivityAt: p.createdAt,
      workStartedAt: p.screenAttention ? null : p.createdAt,
      origin: 'weevils',
      controllable: true,
      live: true,
      hasScreen: true,
      subagents: [],
      messageCount: 0,
      lastMessage: now - p.createdAt < 60_000 ? 'démarrage…' : undefined,
    }
  }

  sessions(now = Date.now()): Session[] {
    const list = this.store
      .all()
      .filter((t) => now - t.lastActivityAt < RECENT_MS && (t.messages.length > 0 || this.paneFor(t.id)))
      .map((t) => this.toSession(t, now))
    const known = new Set(list.map((s) => s.id))
    for (const p of this.panes) {
      const id = p.sessionId ?? p.name
      if (!known.has(id)) list.push(this.placeholder(p, now))
    }
    return list.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  projects(sessions: Session[]): Project[] {
    const map = new Map<string, Project>()
    for (const s of sessions) {
      const where = place(s.cwd, PROJECTS_DIR)
      const p = map.get(s.projectId) ?? { id: s.projectId, name: where.projectName, kind: where.kind, repos: [], lastActivityAt: 0 }
      if (s.repo && !p.repos.includes(s.repo)) p.repos.push(s.repo)
      p.lastActivityAt = Math.max(p.lastActivityAt, s.lastActivityAt)
      map.set(p.id, p)
    }
    // Les projets d'abord, les catégories inventées ensuite ; chacun par activité récente.
    return [...map.values()].sort((a, b) => (a.kind === b.kind ? b.lastActivityAt - a.lastActivityAt : a.kind === 'repo' ? -1 : 1))
  }

  snapshot(): Snapshot {
    if (this.snap) return this.snap
    const now = Date.now()
    const sessions = this.sessions(now)
    this.snap = {
      version: this.version,
      now,
      machines: [MACHINE],
      projects: this.projects(sessions),
      sessions,
      h24: this.h24,
      conversations: [],
      main: this.main.slice(-30),
    }
    return this.snap
  }

  private resolveId(id: string) {
    const p = this.panes.find((x) => x.name === id && x.sessionId)
    return p?.sessionId ?? id
  }

  detail(id: string): SessionDetail | undefined {
    const real = this.resolveId(id)
    const session = this.snapshot().sessions.find((s) => s.id === real)
    if (!session) return undefined
    const t = this.store.get(real)
    return { session, messages: t?.messages ?? [] }
  }

  // ---------------------------------------------------------------- actions

  /** Écrit dans la session ; si elle n'a plus de processus, la rouvre dans une pane weevils. */
  async send(id: string, text: string): Promise<{ id: string }> {
    const real = this.resolveId(id)
    const s = this.snapshot().sessions.find((x) => x.id === real)
    if (!s) throw new Error('session introuvable')
    if (!text.trim()) throw new Error('message vide')
    const pane = this.paneFor(real)
    if (pane) {
      await sendText(pane.name, text)
      return { id: real }
    }
    if (!s.controllable) {
      throw new Error('Cette session est ouverte dans un terminal que weevils ne pilote pas. Ferme-la ou lance tes sessions avec wv pour leur écrire d’ici.')
    }
    const cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : HOME
    const command = s.tool === 'claude' ? ['claude', '--resume', s.id, text] : ['codex', 'resume', s.id, text]
    await this.spawn(s.tool, cwd, s.title, command, s.id)
    return { id: real }
  }

  async key(id: string, key: string) {
    const pane = this.paneFor(this.resolveId(id))
    if (!pane) throw new Error('weevils ne voit pas l’écran de cette session')
    await sendKey(pane.name, key)
  }

  async screen(id: string): Promise<string | null> {
    const pane = this.paneFor(this.resolveId(id))
    if (!pane) return null
    return capture(pane.name)
  }

  async create(input: { projectId: string; repo?: string; tool: Tool; text: string }): Promise<{ id: string }> {
    const repos = this.projects(this.sessions()).find((p) => p.id === input.projectId)?.repos ?? []
    const repo = input.repo ?? repos[0] ?? (fs.existsSync(path.join(PROJECTS_DIR, input.projectId)) ? input.projectId : undefined)
    const cwd = repo ? path.join(PROJECTS_DIR, repo) : PROJECTS_DIR
    if (!fs.existsSync(cwd)) throw new Error(`dossier introuvable : ${cwd}`)
    const text = input.text.trim()
    const title = text ? text.replace(/\s+/g, ' ').slice(0, 60) : 'nouvelle session'
    if (input.tool === 'claude') {
      const id = crypto.randomUUID()
      await this.spawn('claude', cwd, title, ['claude', '--session-id', id, ...(text ? [text] : [])], id)
      return { id }
    }
    const name = await this.spawn('codex', cwd, title, ['codex', ...(text ? [text] : [])])
    return { id: name }
  }

  private async spawn(tool: Tool, cwd: string, title: string, command: string[], sessionId?: string): Promise<string> {
    const short = crypto.randomBytes(3).toString('hex')
    const name = `wv-${path.basename(cwd).slice(0, 18)}-${short}`
    await spawnWv(name, cwd, tool, title.slice(0, 60), command, sessionId)
    this.panes.push({ name, tool, sessionId, title, cwd, createdAt: Date.now() })
    this.bump()
    return name
  }

  // ---------------------------------------------------------------- agent principal

  private route(text: string): { kind: 'forward' | 'open'; sessionId: string } | { kind: 'unknown' } {
    const n = norm(text)
    const words = n.split(' ')
    const sessions = this.snapshot().sessions
    const projects = this.snapshot().projects
    const project = projects.find((p) => words.includes(norm(p.name)) || words.includes(p.id) || p.repos.some((r) => words.includes(r.toLowerCase())))
    if (!project) return { kind: 'unknown' }
    const tool: Tool | null = words.includes('claude') ? 'claude' : words.includes('codex') ? 'codex' : null
    const rank = { needs_user: 0, working: 1, idle: 2, done: 3 }
    const target = sessions
      .filter((s) => s.projectId === project.id && s.controllable && (!tool || s.tool === tool))
      .sort((a, b) => rank[a.status] - rank[b.status] || b.lastActivityAt - a.lastActivityAt)[0]
    if (!target) return { kind: 'unknown' }
    return { kind: /^(ouvre|ouvrir|montre|affiche|va )/.test(n) ? 'open' : 'forward', sessionId: target.id }
  }

  private label(id: string) {
    const s = this.snapshot().sessions.find((x) => x.id === id)
    return s ? `${s.projectId} · ${s.tool} · « ${s.title} »` : 'cette session'
  }

  async sendMain(text: string) {
    const at = Date.now()
    const id = crypto.randomUUID()
    this.main.push({ id, role: 'user', text, at })
    const r = this.route(text)
    if (r.kind === 'unknown') {
      this.main.push({ id: `${id}-a`, role: 'assistant', text: 'Je ne sais pas encore où envoyer ça. Choisis la session :', at, ask: { text } })
    } else if (r.kind === 'open') {
      this.main.push({ id: `${id}-a`, role: 'assistant', text: `J’ouvre ${this.label(r.sessionId)}.`, at, targetSessionId: r.sessionId })
    } else {
      try {
        await this.send(r.sessionId, text)
        this.main.push({ id: `${id}-a`, role: 'assistant', text: `Envoyé à ${this.label(r.sessionId)}.`, at, targetSessionId: r.sessionId })
      } catch (e) {
        this.main.push({ id: `${id}-a`, role: 'assistant', text: `Pas envoyé : ${(e as Error).message}`, at, targetSessionId: r.sessionId })
      }
    }
    this.persist()
    this.bump()
    return { route: r }
  }

  async chooseMain(mainId: string, sessionId: string) {
    const m = this.main.find((x) => x.id === mainId)
    if (!m?.ask || m.ask.chosenSessionId) return
    m.ask.chosenSessionId = sessionId
    const at = Date.now()
    try {
      await this.send(sessionId, m.ask.text)
      this.main.push({ id: `${mainId}-c`, role: 'assistant', text: `Envoyé à ${this.label(sessionId)}.`, at, targetSessionId: sessionId })
    } catch (e) {
      this.main.push({ id: `${mainId}-c`, role: 'assistant', text: `Pas envoyé : ${(e as Error).message}`, at, targetSessionId: sessionId })
    }
    this.persist()
    this.bump()
  }

  // ---------------------------------------------------------------- H24

  /** Jobs longs (~/logs) et timers systemd « wv-* ». */
  refreshH24() {
    const now = Date.now()
    const out: H24Activity[] = []
    try {
      for (const f of fs.readdirSync(LOGS_DIR)) {
        if (!f.endsWith('.log') || f === 'weevils.log' || f === 'weevilsd.log') continue
        const file = path.join(LOGS_DIR, f)
        const st = fs.statSync(file)
        const running = now - st.mtimeMs < 120_000
        // Ce qui tourne, plus ce qui a fini dans les 3 dernières heures.
        if (!running && now - st.mtimeMs > 3 * 3600_000) continue
        let last = ''
        try {
          const fd = fs.openSync(file, 'r')
          const len = Math.min(2048, st.size)
          const buf = Buffer.alloc(len)
          fs.readSync(fd, buf, 0, len, st.size - len)
          fs.closeSync(fd)
          last =
            buf
              .toString('utf8')
              .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .pop() ?? ''
        } catch {
          /* illisible */
        }
        const name = f.replace(/\.log$/, '')
        out.push({
          id: `job:${name}`,
          title: name,
          kind: 'job',
          projectId: familyOf(name),
          schedule: 'job lancé à la main',
          enabled: true,
          runState: running ? 'running' : 'waiting',
          runStartedAt: running ? st.birthtimeMs || null : st.mtimeMs,
          lastEvent: last.slice(0, 160) || '—',
          canToggle: false,
        })
      }
    } catch {
      /* pas de ~/logs */
    }
    execFile('systemctl', ['--user', 'list-timers', '--all', '--output=json'], { timeout: 4000 }, (err, stdout) => {
      if (!err) {
        try {
          for (const t of JSON.parse(stdout) as { unit: string; next?: number; last?: number; activates: string }[]) {
            if (!t.unit.startsWith('wv-')) continue
            out.push({
              id: `timer:${t.unit}`,
              title: t.unit.replace(/^wv-/, '').replace(/\.timer$/, ''),
              kind: 'timer',
              projectId: null,
              schedule: t.next ? `prochaine : ${new Date(t.next / 1000).toLocaleString('fr-FR')}` : 'planifié',
              enabled: !!t.next,
              runState: t.next ? 'waiting' : 'paused',
              runStartedAt: null,
              lastEvent: t.last ? `dernière : ${new Date(t.last / 1000).toLocaleString('fr-FR')}` : 'jamais lancé',
              canToggle: true,
            })
          }
        } catch {
          /* format inattendu */
        }
      }
      out.sort((a, b) => Number(b.runState === 'running') - Number(a.runState === 'running') || a.title.localeCompare(b.title))
      out.splice(16)
      if (JSON.stringify(out) !== JSON.stringify(this.h24)) {
        this.h24 = out
        this.bump()
      }
    })
  }

  async toggleH24(id: string) {
    const a = this.h24.find((x) => x.id === id)
    if (!a?.canToggle) throw new Error('cette activité ne se met pas en pause')
    const unit = id.replace(/^timer:/, '')
    await new Promise<void>((resolve, reject) =>
      execFile('systemctl', ['--user', a.enabled ? 'stop' : 'start', unit], { timeout: 5000 }, (err) => (err ? reject(err) : resolve())),
    )
    this.refreshH24()
  }

  // ---------------------------------------------------------------- fichiers

  repoDir(repo: string) {
    if (!/^[\w.@+-]+$/.test(repo) || repo.startsWith('.')) throw new Error('repo invalide')
    const dir = path.join(PROJECTS_DIR, repo)
    if (!fs.existsSync(dir)) throw new Error('repo introuvable')
    return dir
  }

  async files(repo: string): Promise<string[]> {
    const dir = this.repoDir(repo)
    return new Promise((resolve) => {
      execFile('git', ['-C', dir, 'ls-files', '--cached', '--others', '--exclude-standard'], { timeout: 8000, maxBuffer: 32 << 20 }, (err, stdout) => {
        if (!err) return resolve(stdout.split('\n').filter(Boolean).slice(0, 20000))
        // Pas un repo git : simple parcours, sans node_modules ni dossiers cachés.
        const out: string[] = []
        const walk = (rel: string) => {
          if (out.length > 5000) return
          for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue
            const r = rel ? `${rel}/${e.name}` : e.name
            if (e.isDirectory()) walk(r)
            else out.push(r)
          }
        }
        try {
          walk('')
        } catch {
          /* dossier illisible */
        }
        resolve(out)
      })
    })
  }

  file(repo: string, rel: string): { path: string; size: number; binary: boolean; content: string; truncated: boolean } {
    const dir = this.repoDir(repo)
    const full = path.resolve(dir, rel)
    if (!full.startsWith(dir + path.sep)) throw new Error('chemin refusé')
    const real = fs.realpathSync(full)
    if (!real.startsWith(fs.realpathSync(dir) + path.sep)) throw new Error('chemin refusé')
    const st = fs.statSync(real)
    const max = 400_000
    const fd = fs.openSync(real, 'r')
    const buf = Buffer.alloc(Math.min(st.size, max))
    fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    const binary = buf.subarray(0, 8000).includes(0)
    return { path: rel, size: st.size, binary, content: binary ? '' : buf.toString('utf8'), truncated: st.size > max }
  }
}
