// Accueil et branchements : weevboss accueille les nouveaux venus dans son fil, comme un collègue, et propose chaque
// brique (téléphone, machine, Claude Code, Codex, GitHub, voix, diable, e-mail, Siri, quota, sécurité) au moment où elle
// sert. Tout part de l'état réel, détecté ici : jamais une liste figée.
//
// - detect() : l'état de chaque brique (machine : type, OS, CPU, RAM, toujours allumée ou non ; outils installés,
//   connexions, clés présentes…). « weevils setup » l'imprime pour weevboss.
// - Les messages que weevilsd écrit au nom de weevboss (accueil, réponse à une puce, confirmation d'un branchement)
//   vivent dans DATA_DIR/setup.json et se mêlent à son fil, comme ceux du devil mode. Ils arrivent aussi chez weevboss :
//   le prochain message qu'on lui envoie porte un bloc ⟦weevils …⟧ (jamais affiché) qui les résume.
// - apply() reçoit les réponses d'un parcours (champ du bas, src/ui/setup.tsx), vérifie pour de vrai (le modèle répond,
//   GitHub accepte le jeton, Gmail accepte le mot de passe…), écrit ~/.config/weevils/env et répond dans le fil.
//   Les secrets ne passent ni par le modèle ni par les journaux : le fil n'en montre que les 4 derniers caractères.

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Message } from '../shared/api.ts'
import type { MachineFacts } from '../shared/infra.ts'
import { CONTEXT_BLOCK, FIELDS, type Brick, type Device } from '../shared/setup.ts'
import { resetAuthors, authors } from './authors.ts'
import { CODEX_DIR, CONFIG_FILE, DATA_DIR, HOME, HOST, MACHINE, PORT, PUBLIC_URL, USER_NAME } from './config.ts'
import { devilConfig } from './devil.ts'
import { facts } from './discover.ts'
import { cartesia, edgeTts } from './fast.ts'
import { lang, onLangChange, tr } from './i18n.ts'
import M from './i18n/setup.ts'
import { Imap } from './imap.ts'
import { mailConfig } from './mailbridge.ts'
import { quotas } from './usage.ts'

const FILE = path.join(DATA_DIR, 'setup.json')
/** Le clone de weevils qui tourne (install.sh, changer l'interface en direct). */
const CLONE = path.resolve(import.meta.dirname, '..')

export type Kind = 'vps' | 'server' | 'container' | 'vm' | 'laptop' | 'desktop' | 'wsl'

export interface MachineInfo {
  kind: Kind
  mac: boolean
  os: string
  cpus: number
  ramGb: number
  uptimeDays: number
  /** Allumée en continu : oui (serveur), non (portable), null (on ne sait pas). */
  alwaysOn: boolean | null
  provider?: string
  host: string
  user: string
  /** Comment l'atteindre en SSH depuis un ordinateur : user@ip ou user@nom. */
  sshTarget: string
  /** Agents qui tiennent à la fois, à la louche (≈ 1 Go chacun, 1,5 Go gardés pour le reste). */
  agents: number
  /** Les autres machines branchées (en ligne). */
  others: string[]
  /** Une des autres machines reste allumée (VPS, serveur). */
  othersAlwaysOn: boolean
}

export interface SetupState {
  machine: MachineInfo
  reach: 'public' | 'lan' | 'local'
  url: string
  https: boolean
  port: number
  clone: string
  claude: { installed: boolean; logged: boolean }
  codex: { installed: boolean; logged: boolean }
  github: { installed: boolean; logged: boolean; login?: string }
  voice: { spoken: 'cartesia' | 'edge' | null; openai: boolean; https: boolean }
  devil: { plugged: boolean; model?: string }
  mail: { on: boolean; address?: string; authors: number }
  phone: { devices: number; push: number }
  shortcut: boolean
  security: { safe: boolean; https: boolean; exposedHttp: boolean }
  quota: string[]
  pkg: 'apt' | 'dnf' | 'pacman' | 'brew' | null
  sudo: 'yes' | 'password' | 'no'
  tools: { git: boolean; tmux: boolean; curl: boolean; python3: boolean; qrencode: boolean; pipx: boolean; uv: boolean; node: number }
  projects: number
}

export interface SetupDeps {
  bump: () => void
  /** Machines du fil (la première est celle-ci) et nombre de projets. */
  feed: () => { machines: { id: string; name: string; online?: boolean }[]; projects: number }
  /** Faits des autres machines (fédération), pour savoir si l'une reste allumée. */
  remoteFacts: () => Promise<MachineFacts[]>
  devices: () => number
  push: () => number
  shortcut: () => boolean
  /** Ids des bulles et gestes déjà vus (hints.json). */
  seen: () => string[]
  /** Le fil de weevboss a déjà servi (installation existante) : pas d'accueil. */
  hasHistory: () => boolean
  /** Le pont e-mail vient d'être configuré : le lancer. */
  startMail: () => void
}

interface Persisted {
  log: Message[]
  device?: Device
  /** Quand chaque brique, astuce ou geste a été proposé par weevboss (ou weevilsd en son nom). */
  marks: Record<string, number>
  /** Jusqu'où weevboss (le modèle) a reçu les messages écrits en son nom. */
  bossSeenAt: number
  welcomed?: boolean
  claudeLogged?: boolean
  githubLogged?: boolean
}

// ---------------------------------------------------------------- détection

const read = (f: string) => {
  try {
    return fs.readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}
const run = (cmd: string, args: string[], timeout = 6000, env?: NodeJS.ProcessEnv) =>
  new Promise<{ ok: boolean; out: string }>((resolve) =>
    execFile(cmd, args, { timeout, env: env ?? process.env }, (err, out) => resolve({ ok: !err, out: String(out ?? '').trim() })),
  )

/** Une commande installée : dans le PATH, ou là où les installateurs la posent. */
export function which(cmd: string): string | null {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), path.join(HOME, '.local', 'bin'), path.join(HOME, '.claude', 'local'), path.join(HOME, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin']
  for (const d of dirs.filter(Boolean)) {
    const f = path.join(d, cmd)
    try {
      fs.accessSync(f, fs.constants.X_OK)
      return f
    } catch {
      /* pas ici */
    }
  }
  return null
}

/** Claude Code connecté : les identifiants de /login, une clé dans l'environnement, ou le compte noté par Claude (macOS : trousseau). */
export function claudeLogged(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return true
  try {
    if (fs.statSync(path.join(HOME, '.claude', '.credentials.json')).size > 2) return true
  } catch {
    /* pas de fichier */
  }
  return process.platform === 'darwin' && /"oauthAccount"\s*:\s*\{/.test(read(path.join(HOME, '.claude.json')))
}

let ghCache: { at: number; v: { installed: boolean; logged: boolean; login?: string } } | null = null
async function github(force = false) {
  if (!force && ghCache && Date.now() - ghCache.at < 60_000) return ghCache.v
  const gh = which('gh')
  let v: { installed: boolean; logged: boolean; login?: string } = { installed: !!gh, logged: false }
  if (gh) {
    const r = await run(gh, ['api', 'user', '-q', '.login'], 8000)
    v = { installed: true, logged: r.ok && !!r.out, login: r.ok ? r.out : undefined }
  }
  ghCache = { at: Date.now(), v }
  return v
}

function osName(): string {
  if (process.platform === 'darwin') return 'macOS'
  const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(read('/etc/os-release'))?.[1]
  return pretty?.replace(/\s+LTS$/, '') || os.type()
}

async function sudo(): Promise<SetupState['sudo']> {
  if (process.getuid?.() === 0) return 'yes'
  if (process.platform === 'darwin') return 'password'
  if (!which('sudo')) return 'no'
  if ((await run('sudo', ['-n', 'true'], 3000)).ok) return 'yes'
  return /\b(sudo|wheel|admin)\b/.test((await run('id', ['-nG'], 3000)).out) ? 'password' : 'no'
}

function pkg(): SetupState['pkg'] {
  if (process.platform === 'darwin') return 'brew'
  if (which('apt-get')) return 'apt'
  if (which('dnf')) return 'dnf'
  if (which('pacman')) return 'pacman'
  return null
}

const SERVER_VIRT = /^(kvm|qemu|vmware|xen|microsoft|amazon|google|oracle|bochs|parallels|bhyve|powervm|zvm|acrn|uml|apple|sre)$/
const CONTAINER_VIRT = /^(docker|podman|lxc|lxc-libvirt|systemd-nspawn|rkt|openvz|container-other|wsl)$/

async function machine(deps: SetupDeps): Promise<MachineInfo> {
  const f = await facts().catch(() => null)
  const virt = f?.virt ?? ''
  const mac = process.platform === 'darwin'
  const battery = (() => {
    try {
      return fs.readdirSync('/sys/class/power_supply').some((d) => d.startsWith('BAT'))
    } catch {
      return false
    }
  })()
  const wsl = virt === 'wsl' || /microsoft/i.test(read('/proc/version'))
  let kind: Kind
  if (wsl) kind = 'wsl'
  else if (mac) kind = /book/i.test((await run('sysctl', ['-n', 'hw.model'], 2000)).out) ? 'laptop' : 'desktop'
  else if (CONTAINER_VIRT.test(virt)) kind = 'container'
  else if (SERVER_VIRT.test(virt)) kind = f?.publicIp || f?.provider ? 'vps' : 'vm'
  else if (f?.laptop || battery) kind = 'laptop'
  else if (f?.publicIp) kind = 'server'
  else kind = 'desktop'
  const uptimeDays = os.uptime() / 86400
  const alwaysOn = kind === 'laptop' || kind === 'wsl' ? false : kind === 'desktop' ? (uptimeDays > 3 ? true : null) : true
  // Dans un conteneur, les limites qui comptent sont celles du cgroup (--cpus, --memory), pas celles de l'hôte.
  const quota = /^(\d+)\s+(\d+)/.exec(read('/sys/fs/cgroup/cpu.max'))
  const memMax = Number(read('/sys/fs/cgroup/memory.max').trim())
  const cpus = Math.min(os.cpus().length || 1, quota ? Math.max(1, Math.ceil(Number(quota[1]) / Number(quota[2]))) : Infinity)
  const ramGb = (Number.isFinite(memMax) && memMax > 0 && memMax < os.totalmem() ? memMax : os.totalmem()) / 2 ** 30
  const feed = deps.feed()
  const others = feed.machines.filter((m) => m.id !== MACHINE.id && m.online !== false).map((m) => m.name)
  const remote = others.length ? await deps.remoteFacts().catch(() => []) : []
  const user = f?.user || os.userInfo().username
  const publicHost = (() => {
    try {
      return PUBLIC_URL ? new URL(PUBLIC_URL).hostname : ''
    } catch {
      return ''
    }
  })()
  const host = MACHINE.name || os.hostname()
  return {
    kind,
    mac,
    os: osName(),
    cpus,
    ramGb,
    uptimeDays,
    alwaysOn,
    provider: f?.provider,
    host,
    user,
    sshTarget: `${user}@${(f?.publicIp && f.ip) || (kind === 'vps' || kind === 'server' ? publicHost : '') || os.hostname()}`,
    agents: Math.max(1, Math.floor(ramGb - 1.5)),
    others,
    othersAlwaysOn: remote.some((r) => (r.virt && SERVER_VIRT.test(r.virt) && r.publicIp) || !!r.provider || (r.virt && CONTAINER_VIRT.test(r.virt) && r.virt !== 'wsl')),
  }
}

/** Le quota des abonnements, en clair (« Claude max session 12 % · semaine 40 % »). */
async function quotaLines(): Promise<string[]> {
  const q = await quotas().catch(() => null)
  if (!q) return []
  const t = tr(M)
  const out: string[] = []
  for (const [tool, info] of [['Claude', q.claude], ['Codex', q.codex]] as const) {
    if (!info?.ok || !info.windows.length) continue
    out.push(t.quotaLine(tool, info.plan ?? '', info.windows.filter((w) => w.kind !== 'model').map((w) => t.quotaWindow(w.kind, Math.round(w.percent))).join(', ')))
  }
  return out
}

// ---------------------------------------------------------------- fichier de config

/** Écrit des clés dans ~/.config/weevils/env (remplace la ligne existante, sinon ajoute) et dans l'environnement du
 * serveur, pour que le changement prenne aussitôt. Valeur vide = clé vidée. Jamais journalisé. */
export function writeConfig(changes: Record<string, string>) {
  const lines = read(CONFIG_FILE).split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const [k, raw] of Object.entries(changes)) {
    // i18n-ignore : erreur de programmation, jamais montrée
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) throw new Error(`bad key ${k}`)
    const v = raw.replace(/[\r\n]+/g, ' ').trim()
    const live = lines.findIndex((l) => new RegExp(`^\\s*${k}\\s*=`).test(l))
    const example = lines.findIndex((l) => new RegExp(`^\\s*#\\s*${k}\\s*=`).test(l))
    const line = `${k}=${v}`
    if (live >= 0) lines[live] = line
    else if (example >= 0) lines.splice(example + 1, 0, line)
    else lines.push(line)
    if (v) process.env[k] = v
    else delete process.env[k]
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 })
  fs.renameSync(tmp, CONFIG_FILE)
}

// ---------------------------------------------------------------- gestes et astuces (pour weevboss)

/** Chaque geste de l'app, et l'id (hints.json) qui dit qu'il a été vu ou fait. */
export const GESTURES: [id: string, seen: string, what: string][] = [
  ['voice', 'voice', 'tap the weevboss logo to talk, tap again to stop, once more to send'],
  ['repos', 'repos', 'swipe the feed left: every GitHub repo; + pins one to the feed'],
  ['calm', 'calm', 'pinch the feed: conversation mode (only the messages); pinch again to come back'],
  ['back', 'g-back', 'on a page, swipe right from the left edge: back'],
  ['collapse', 'g-collapse', 'pull the open weevboss thread down: it folds back'],
  ['copy', 'g-copy', 'long-press a message: copies it whole'],
  ['ask', 'g-ask', 'in an open thread, tap a word (or slide across several): ask about it, typed or by voice with the logo'],
  ['fold', 'g-fold', 'tap a project name: fold or unfold it'],
  ['newSession', 'newSession', 'the + of a project: a new claude or codex session there'],
  ['devil', 'devil', 'the little devil next to the logo: switch this thread to the other model'],
  ['h24', 'h24', 'the 24/7 band: what runs around the clock'],
]

/** Astuces d'usage, données une fois chacune au bon moment. */
export const TIPS: [id: string, what: string][] = [
  ['liveUi', `ask me to change this interface (colors, layout, a new button): I hand it to a session in the weevils clone (${CLONE}) and it updates live`],
  ['files', "explore any machine's files: bottom band, the machine, then /"],
  ['photo', 'the + in the composer: send me a photo, a screenshot or a file'],
  ['ultracode', 'say “ultracode” for a big job: the session deploys several agents in parallel'],
  ['wv', 'in a terminal on the machine: `wv` opens a session the app sees (`wv codex`, `wv ls`, `wv a`)'],
  ['model', 'ask me “opus”, “max effort”, “fast” or “compact” for a session: I type the right slash command'],
  ['newRepo', 'tell me an idea that fits no repo: I create the repo and open a session in it'],
  ['settings', 'bottom band: language, theme, the intro again, tips'],
]

// ---------------------------------------------------------------- installer : la marche à suivre exacte

function ghNoSudo(): string {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64'
  return `mkdir -p ~/.local/bin && curl -fsSL "$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -o 'https://[^"]*linux_${arch}.tar.gz' | head -1)" | tar xz -C /tmp && mv /tmp/gh_*_linux_${arch}/bin/gh ~/.local/bin/`
}

export function ghInstall(s: SetupState): string {
  if (s.pkg === 'brew') return 'brew install gh'
  if (s.sudo === 'no' || !s.pkg) return ghNoSudo()
  return { apt: 'sudo apt update && sudo apt install -y gh', dnf: 'sudo dnf install -y gh', pacman: 'sudo pacman -S --noconfirm github-cli' }[s.pkg]
}

export function edgeInstall(s: SetupState): string {
  if (s.tools.pipx) return 'pipx install edge-tts'
  if (s.pkg === 'brew') return 'brew install pipx && pipx install edge-tts'
  if (s.tools.uv) return 'uv tool install edge-tts'
  if (s.sudo !== 'no' && s.pkg === 'apt') return 'sudo apt install -y pipx && pipx ensurepath && pipx install edge-tts'
  if (s.sudo !== 'no' && s.pkg === 'dnf') return 'sudo dnf install -y pipx && pipx ensurepath && pipx install edge-tts'
  if (s.sudo !== 'no' && s.pkg === 'pacman') return 'sudo pacman -S --noconfirm python-pipx && pipx ensurepath && pipx install edge-tts'
  return 'curl -LsSf https://astral.sh/uv/install.sh | sh && ~/.local/bin/uv tool install edge-tts'
}

/** Tout ce qui manque sur cette machine, dans l'ordre, en commandes à copier ; puis les connexions. */
export function installPlan(s: SetupState): string {
  const t = tr(M)
  const blocks: string[] = []
  const have: string[] = []
  const can = s.sudo !== 'no'
  const base = (['git', 'tmux', 'curl', 'python3', 'qrencode'] as const).filter((x) => !s.tools[x])
  for (const x of ['git', 'tmux', 'curl', 'python3'] as const) if (s.tools[x]) have.push(x)
  if (base.length && can && s.pkg) {
    const names = s.pkg === 'pacman' ? base.map((b) => (b === 'python3' ? 'python' : b)) : base
    blocks.push({ apt: `sudo apt update && sudo apt install -y ${names.join(' ')}`, dnf: `sudo dnf install -y ${names.join(' ')}`, pacman: `sudo pacman -S --noconfirm ${names.join(' ')}`, brew: `brew install ${names.join(' ')}` }[s.pkg])
  }
  if (s.tools.node < 22) {
    if (s.pkg === 'brew') blocks.push('brew install node')
    else if (can && s.pkg === 'apt') blocks.push('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs')
    else if (can && s.pkg === 'dnf') blocks.push('sudo dnf install -y nodejs22')
    else if (can && s.pkg === 'pacman') blocks.push('sudo pacman -S --noconfirm nodejs npm')
    else blocks.push('curl -fsSL https://fnm.vercel.app/install | bash && ~/.local/share/fnm/fnm install 22')
  } else have.push(`node ${s.tools.node}`)
  if (!s.claude.installed) blocks.push('curl -fsSL https://claude.ai/install.sh | bash')
  else have.push('claude')
  if (!s.github.installed) blocks.push(ghInstall(s))
  else have.push('gh')
  if (s.voice.spoken !== 'edge' && s.voice.spoken !== 'cartesia') blocks.push(edgeInstall(s))
  else if (s.voice.spoken === 'edge') have.push('edge-tts')
  if (!s.codex.installed) blocks.push(`npm i -g @openai/codex${can && s.pkg !== 'brew' ? '' : ' --prefix ~/.local'}`)
  else have.push('codex')
  const logins: string[] = []
  if (!s.claude.logged) logins.push('claude')
  if (!s.github.logged) logins.push('gh auth login')
  if (!s.codex.logged) logins.push('codex')
  const fence = (c: string) => (c.includes('\n') ? '```sh\n' + c + '\n```' : '`' + c + '`')
  const parts = [t.installIntro(s.machine.os, blocks.length > 0)]
  if (!can && blocks.length) parts.push(t.installNoSudo)
  parts.push(...blocks.map(fence))
  if (have.length) parts.push(`${t.installDone} ${have.join(', ')}.`)
  if (logins.length) parts.push(t.installLogins, fence(logins.join('\n')))
  if (blocks.length || logins.length) parts.push(t.installAfter)
  return parts.join('\n\n')
}

// ---------------------------------------------------------------- deviner la brique d'une question (sans modèle)

/** Mots qui désignent une brique, en français et en anglais ; le premier qui colle gagne. */
const GUESS: [Brick, RegExp][] = [
  ['install', /\b(install|installer|installe|installation|setup|que dois|what do i need|dépendances?|dependencies)\b/i],
  ['devil', /\b(diable|devil|abliterat\w*|open.?weight|ollama|lm ?studio|vllm|openrouter)\b/i],
  ['github', /\b(github|gh|repos?|dépôts?)\b/i],
  ['voice', /\b(voix|voice|dict\w*|micro|cartesia|parler|speak|talk)\b/i],
  ['mail', /\b(e-?mails?|courriel|gmail|chatgpt|pont|bridge)\b/i],
  ['shortcut', /\b(siri|raccourcis?|shortcuts?|bouton action|action button)\b/i],
  ['machine', /\b(vps|serveur|server|machines?|pc|mac|ordi\w*|computer|laptop|portable|nuit|night)\b/i],
  ['push', /\b(notif\w*|prévenir|alertes?)\b/i],
  ['phone', /\b(téléphone|phone|iphone|android|qr|écran d.accueil|home screen)\b/i],
  ['reach', /\b(extérieur|dehors|outside|anywhere|partout|tailscale|domaine|domain|https)\b/i],
  ['codex', /\b(codex|openai agent)\b/i],
  ['quota', /\b(quota|abonnement|subscription|plan|limite?s?)\b/i],
  ['security', /\b(sécurité|security|code d.accès|access code|mot de passe|password)\b/i],
  ['claude', /\b(claude|connecter|login|sign in)\b/i],
]
export const guessBrick = (text: string): Brick | null => GUESS.find(([, re]) => re.test(text))?.[0] ?? null

// ---------------------------------------------------------------- le module

const PALETTE = ['#ff6b8a', '#3fc1f0', '#f5a524', '#7c5cff', '#22c55e', '#ff7a1a', '#e64980', '#14b8a6']
/** Un message suivi de la puce d'une brique (un bouton dessous, dans l'app). */
const chip = (text: string, brick: Brick) => `${text} [[setup:${brick}]]`
const tail = (s: string) => tr(M).masked(s.slice(-4))
const short = (e: unknown) => {
  const err = e as Error & { cause?: { code?: string } }
  return (err.cause?.code ?? err.message ?? String(e)).slice(0, 120)
}

export class Setup {
  private p: Persisted
  private cache: { at: number; v: SetupState } | null = null
  private deps: SetupDeps

  constructor(deps: SetupDeps) {
    this.deps = deps
    this.p = (() => {
      try {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Persisted>
        return { log: raw.log ?? [], marks: raw.marks ?? {}, bossSeenAt: raw.bossSeenAt ?? 0, device: raw.device, welcomed: raw.welcomed, claudeLogged: raw.claudeLogged, githubLogged: raw.githubLogged }
      } catch {
        return { log: [], marks: {}, bossSeenAt: 0 }
      }
    })()
    // Langue changée avant le moindre échange : l'accueil se réécrit dans la nouvelle langue.
    onLangChange(() => {
      if (this.p.device && this.p.log.length && this.p.log.every((m) => m.id.startsWith('welcome-'))) {
        this.p.log = []
        this.p.welcomed = false
        void this.welcome(this.p.device, false)
      }
    })
    void github()
    // Une connexion faite dans un terminal (claude, gh auth login) : weevboss le remarque et le dit.
    setInterval(() => void this.watch(), 5000).unref()
  }

  private save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(FILE, JSON.stringify({ ...this.p, log: this.p.log.slice(-120) }))
    } catch {
      /* disque plein : gardé en mémoire */
    }
  }

  /** Ce que l'app doit savoir pour ses bulles (renvoyer vers weevboss quand un réglage manque). Rapide : pas de sous-processus. */
  flags() {
    return { claude: claudeLogged(), voice: !!(cartesia() || edgeTts()), dictation: !!process.env.OPENAI_API_KEY?.trim(), github: ghCache?.v.logged ?? true, welcomed: !!this.p.welcomed }
  }

  /** Les messages écrits au nom de weevboss (et les réponses des parcours), à mêler à son fil. */
  messages = () => this.p.log
  welcomed = () => !!this.p.welcomed

  private add(role: 'user' | 'assistant', text: string, id = `setup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`) {
    const last = this.p.log.at(-1)?.at ?? 0
    this.p.log.push({ id, role, text, at: Math.max(Date.now(), last + 1) })
    this.save()
    this.deps.bump()
  }
  say = (text: string) => this.add('assistant', text)
  userSays = (text: string) => this.add('user', text)

  async detect(force = false): Promise<SetupState> {
    if (!force && this.cache && Date.now() - this.cache.at < 15_000) return this.cache.v
    const [m, gh, sd, quota] = await Promise.all([machine(this.deps), github(force), sudo(), quotaLines()])
    const https = PUBLIC_URL.startsWith('https://')
    const reach: SetupState['reach'] = PUBLIC_URL ? 'public' : HOST !== '127.0.0.1' && HOST !== 'localhost' ? 'lan' : 'local'
    const nodeMajor = Number(/^v?(\d+)/.exec(process.version)?.[1] ?? 0)
    const mail = mailConfig()
    const dv = devilConfig()
    const v: SetupState = {
      machine: m,
      reach,
      url: PUBLIC_URL || `http://127.0.0.1:${PORT}`,
      https,
      port: PORT,
      clone: CLONE.startsWith(HOME + path.sep) ? '~' + CLONE.slice(HOME.length) : CLONE,
      claude: { installed: !!which('claude'), logged: claudeLogged() },
      codex: { installed: !!which('codex'), logged: fs.existsSync(path.join(path.dirname(CODEX_DIR), 'auth.json')) },
      github: gh,
      voice: { spoken: cartesia() ? 'cartesia' : edgeTts() ? 'edge' : null, openai: !!process.env.OPENAI_API_KEY?.trim(), https: https || reach === 'local' },
      devil: { plugged: !!dv, model: dv?.model },
      mail: { on: !!mail, address: mail?.address, authors: authors().filter((a) => a.emails.length).length },
      phone: { devices: this.deps.devices(), push: this.deps.push() },
      shortcut: this.deps.shortcut(),
      security: { safe: process.env.WEEVILS_SAFE === '1', https, exposedHttp: (reach === 'lan' || (reach === 'public' && !https)) && m.kind !== 'container' },
      quota,
      pkg: pkg(),
      sudo: sd,
      tools: { git: !!which('git'), tmux: !!which('tmux'), curl: !!which('curl'), python3: !!which('python3'), qrencode: !!which('qrencode'), pipx: !!which('pipx'), uv: !!which('uv'), node: nodeMajor },
      projects: this.deps.feed().projects,
    }
    this.cache = { at: Date.now(), v }
    return v
  }

  // ---------------------------------------------------------------- accueil

  /** Premier lancement : weevboss se présente, puis le téléphone, la machine, et la seule chose qui bloque. Une fois. */
  async welcome(device: Device, stagger = true) {
    if (this.p.welcomed) return
    this.p.welcomed = true
    this.p.device = device
    this.save()
    // Quelqu'un qui parle déjà à weevboss n'est pas un nouveau venu : rien n'est ajouté à son fil.
    if (this.deps.hasHistory()) {
      this.p.claudeLogged = true
      this.p.githubLogged = true
      this.save()
      return void this.deps.bump()
    }
    const s = await this.detect(true)
    const t = tr(M)
    const out: string[] = [t.hello(USER_NAME)]
    if (!device.mobile) out.push(s.reach === 'local' ? `${t.phoneDesktopLocal} [[setup:reach]]` : `${t.phoneDesktop} [[setup:phone]]`)
    else if (!device.standalone) out.push(device.os === 'ios' ? t.phoneIos : t.phoneAndroid)
    else if (!s.phone.push) out.push(`${t.phoneInstalled} [[setup:push]]`)
    out.push(t.machine(s.machine))
    if (!s.claude.installed) out.push(t.claudeMissing(s.machine))
    else if (!s.claude.logged) out.push(t.claudeLogin(s.machine))
    else if (!s.github.logged) out.push(`${t.githubPitch} [[setup:github]]`)
    else out.push(t.claudeReady)
    this.p.claudeLogged = s.claude.logged
    this.p.githubLogged = s.github.logged
    out.forEach((text, i) => {
      const post = () => {
        if (this.p.log.some((m) => m.id === `welcome-${i}`)) return
        this.add('assistant', text, `welcome-${i}`)
      }
      if (stagger && i) setTimeout(post, i * 900)
      else post()
    })
  }

  /** Ce qui a changé tout seul (une connexion faite dans un terminal) : dit une fois. */
  private async watch() {
    if (!this.p.welcomed) return
    let changed = false
    if (!this.p.claudeLogged && claudeLogged()) {
      this.p.claudeLogged = true
      changed = true
      const s = await this.detect(true)
      this.say(s.github.logged ? tr(M).claudeReady : `${tr(M).claudeReady} ${tr(M).githubPitch} [[setup:github]]`)
    }
    if (!this.p.githubLogged && which('gh')) {
      const gh = await github()
      if (gh.logged) {
        this.p.githubLogged = true
        changed = true
        this.say(tr(M).githubOk(gh.login ?? ''))
      }
    }
    if (changed) this.save()
  }

  // ---------------------------------------------------------------- briques

  /** Une puce tapée (ou weevboss qui propose) : la marche à suivre de cette brique, à partir de l'état réel. */
  async ask(brick: Brick, device?: Device) {
    const s = await this.detect(true)
    const t = tr(M)
    const d = device ?? this.p.device
    this.mark(brick)
    const text = ((): string => {
      switch (brick) {
        case 'phone':
          return `${t.phoneAsk(s)} [[setup:phone]]`
        case 'push':
          return `${t.pushAsk(d?.os === 'ios', !!d?.standalone)}${d?.os === 'ios' && !d.standalone ? '' : ' [[setup:push]]'}`
        case 'reach':
          return t.reachAsk(s)
        case 'machine':
          return `${t.machine(s.machine).replace(/\s*\[\[setup:machine\]\]/, '')}\n\n${t.machineAsk(s)}`
        case 'claude':
          return !s.claude.installed ? t.claudeMissing(s.machine) : !s.claude.logged ? t.claudeLogin(s.machine) : t.claudeOk
        case 'codex':
          return t.codexAsk(s)
        case 'github':
          return `${t.githubAsk(s, ghInstall(s))}${s.github.installed && !s.github.logged ? ' [[setup:github]]' : ''}`
        case 'voice':
          return `${t.voiceAsk(s, edgeInstall(s))} [[setup:voice]]`
        case 'devil':
          return `${t.devilAsk(s.devil.plugged, s.devil.model ?? '')} [[setup:devil]]`
        case 'mail':
          return s.mail.on ? `${t.mailOk(s.mail.address ?? '').replace(/:$/, '.')} [[setup:author]]` : `${t.mailPitch}\n\n${t.mailAsk} [[setup:mail]]`
        case 'author':
          return `${t.authorAsk} [[setup:author]]`
        case 'quota':
          return t.quotaAsk(s.quota)
        case 'security':
          return t.securityAsk(s)
        case 'shortcut':
          return `${t.shortcutAsk} [[setup:shortcut]]`
        case 'install':
          return installPlan(s)
      }
    })()
    this.say(text)
  }

  /** Claude Code pas encore connecté : weevboss ne peut pas réfléchir, mais il sait déjà répondre aux questions de
   * branchement (« qu'est-ce que je dois installer ? », « comment je branche github ? ») à partir de l'état réel. Le
   * reste reçoit la marche à suivre pour connecter Claude Code. */
  async offline(text: string) {
    this.userSays(text)
    const brick = guessBrick(text)
    if (brick && brick !== 'claude') {
      await this.ask(brick)
      this.say(chip(tr(M).notLoggedShort, 'claude'))
    } else await this.ask('claude')
  }

  mark(id: string) {
    this.p.marks[id] = Date.now()
    this.save()
  }

  /** Une action faite côté app (notifications activées, adresse Siri copiée) : weevboss le confirme. */
  done(brick: Brick) {
    const t = tr(M)
    if (brick === 'push') this.say(t.pushOk)
    if (brick === 'shortcut') this.say(t.shortcutOk)
    this.cache = null
  }

  /** Les réponses d'un parcours (champ du bas) : vérifiées, écrites dans la config, confirmées dans le fil. */
  async apply(brick: Brick, values: Record<string, string>) {
    const fields = FIELDS[brick]
    if (!fields) throw new Error(tr(M).badBrick)
    const t = tr(M)
    const v: Record<string, string> = {}
    for (const f of fields) {
      const x = String(values[f.name] ?? '').trim()
      if (!x && !f.optional) throw new Error(t.badValue(t[`field_${f.name}` as keyof typeof t] as string))
      v[f.name] = x
    }
    // La bulle de l'utilisateur : ce qu'il a répondu, les secrets réduits à leurs 4 derniers caractères.
    this.userSays(
      fields
        .filter((f) => v[f.name])
        .map((f) => `${t[`field_${f.name}` as keyof typeof t] as string} : ${f.secret ? tail(v[f.name]) : v[f.name]}`)
        .join(' · ') || '—',
    )
    const before = this.p.log.length
    try {
      if (brick === 'devil') await this.applyDevil(v)
      else if (brick === 'voice') await this.applyVoice(v)
      else if (brick === 'github') await this.applyGithub(v)
      else if (brick === 'mail') await this.applyMail(v)
      else if (brick === 'author') this.applyAuthor(v)
    } finally {
      // Branché (la réponse ne repropose pas la puce) : les anciens boutons de cette brique disparaissent du fil.
      const reply = this.p.log.slice(before).at(-1)
      if (reply && !reply.text.includes(`[[setup:${brick}]]`)) {
        for (const m of this.p.log.slice(0, before)) m.text = m.text.replaceAll(`[[setup:${brick}]]`, '').trimEnd()
        this.save()
      }
      this.cache = null
      this.deps.bump()
    }
  }

  private async applyDevil(v: Record<string, string>) {
    const t = tr(M)
    let url = v.url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
    if (!/^https?:\/\//.test(url)) url = `${/^(localhost|127\.|10\.|192\.168\.|[\w-]+:\d+$)/.test(url) ? 'http' : 'https'}://${url}`
    const headers = v.key ? { authorization: `Bearer ${v.key}` } : undefined
    const list = async (base: string) => {
      const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const j = (await res.json().catch(() => ({}))) as { data?: { id: string }[]; models?: { id?: string; name?: string }[] }
      return (j.data ?? j.models ?? []).map((m) => ('id' in m && m.id) || ('name' in m && m.name) || '').filter(Boolean) as string[]
    }
    let models: string[] | null = null
    let why = ''
    for (const base of /\/v1$/.test(url) ? [url] : [url, `${url}/v1`]) {
      try {
        models = await list(base)
        url = base
        break
      } catch (e) {
        why ||= short(e)
      }
    }
    if (models && models.length && !models.includes(v.model)) {
      const close = models.find((m) => m.toLowerCase() === v.model.toLowerCase()) ?? models.find((m) => m.toLowerCase().includes(v.model.toLowerCase()))
      if (!close) return this.say(chip(t.devilNoModel(v.model, models.slice(0, 8).join(', ')), 'devil'))
      v.model = close
    }
    // Un vrai message, le plus court possible : le modèle répond, et en combien de temps.
    const t0 = Date.now()
    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ model: v.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 80)}`)
      await res.text()
    } catch (e) {
      return this.say(chip(t.devilFail(why && !models ? why : short(e)), 'devil'))
    }
    writeConfig({ DEVIL_API_URL: url, DEVIL_MODEL: v.model, DEVIL_API_KEY: v.key })
    console.log(`[setup] diable branché (${v.model})`)
    this.say(t.devilOk(v.model, Date.now() - t0))
  }

  private async applyVoice(v: Record<string, string>) {
    const t = tr(M)
    const ok: string[] = []
    const changes: Record<string, string> = {}
    if (v.cartesia) {
      try {
        const res = await fetch('https://api.cartesia.ai/voices?limit=1', { headers: { 'X-API-Key': v.cartesia, 'Cartesia-Version': '2025-04-16' }, signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`${res.status}`)
        changes.CARTESIA_API_KEY = v.cartesia
        ok.push('Cartesia')
      } catch (e) {
        return this.say(chip(t.voiceFail('Cartesia', short(e)), 'voice'))
      }
    }
    if (v.openai) {
      try {
        const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${v.openai}` }, signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`${res.status}`)
        changes.OPENAI_API_KEY = v.openai
        ok.push('OpenAI')
      } catch (e) {
        return this.say(chip(t.voiceFail('OpenAI', short(e)), 'voice'))
      }
    }
    if (!ok.length) return this.say(t.voiceNothing)
    writeConfig(changes)
    console.log(`[setup] voix : ${ok.join(', ')}`)
    this.say(t.voiceOk(ok))
  }

  private async applyGithub(v: Record<string, string>) {
    const t = tr(M)
    let login = ''
    try {
      const res = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${v.token}`, 'user-agent': 'weevils' }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`${res.status}`)
      login = ((await res.json()) as { login?: string }).login ?? ''
    } catch (e) {
      return this.say(chip(t.githubFail(short(e)), 'github'))
    }
    const gh = which('gh')
    if (gh) {
      // gh garde le jeton dans sa propre config (~/.config/gh), comme après « gh auth login ».
      const ok = await new Promise<boolean>((resolve) => {
        const env = { ...process.env }
        delete env.GH_TOKEN
        delete env.GITHUB_TOKEN
        const p = spawn(gh, ['auth', 'login', '--with-token', '--hostname', 'github.com'], { env, stdio: ['pipe', 'ignore', 'ignore'] })
        p.on('error', () => resolve(false))
        p.on('exit', (code) => resolve(code === 0))
        p.stdin.end(v.token + '\n')
      })
      if (!ok) writeConfig({ GH_TOKEN: v.token })
      void run(gh, ['auth', 'setup-git'], 6000)
    } else writeConfig({ GH_TOKEN: v.token })
    if (!process.env.WEEVILS_GH_OWNER && login) writeConfig({ WEEVILS_GH_OWNER: login })
    ghCache = null
    this.p.githubLogged = true
    console.log(`[setup] GitHub branché (${login})`)
    this.say(gh ? t.githubOk(login) : `${t.githubOk(login)} ${t.githubNoCli}`)
  }

  private async applyMail(v: Record<string, string>) {
    const t = tr(M)
    const addr = v.gmail.toLowerCase()
    const m = /^([^@+\s]+)(\+[^@\s]+)?@([^@\s]+\.[a-z]+)$/.exec(addr)
    if (!m) return this.say(chip(t.mailFail(addr), 'mail'))
    const login = `${m[1]}@${m[3]}`
    const alias = `${m[1]}${m[2] ?? '+weevils'}@${m[3]}`
    const pass = v.password.replace(/\s+/g, '')
    const imap = new Imap({ host: process.env.WEEVILS_MAIL_IMAP?.split(':')[0] || 'imap.gmail.com', port: Number(process.env.WEEVILS_MAIL_IMAP?.split(':')[1]) || 993, user: login, pass })
    try {
      await imap.connect(15_000)
      await imap.login()
      // Le libellé que le pont surveille : créé s'il n'existe pas.
      await imap.cmd('CREATE "weevils"').catch(() => undefined)
    } catch (e) {
      imap.close()
      return this.say(chip(t.mailFail(short(e).replace(/^IMAP:\s*/, '')), 'mail'))
    }
    imap.close()
    writeConfig({ WEEVILS_MAIL_ADDRESS: alias, WEEVILS_MAIL_PASSWORD: pass })
    console.log('[setup] pont e-mail branché')
    this.deps.startMail()
    this.say(chip(t.mailOk(alias), 'author'))
  }

  private applyAuthor(v: Record<string, string>) {
    const t = tr(M)
    const email = v.email.toLowerCase()
    const id = v.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
    if (!id || !/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(email)) return this.say(chip(t.authorBad, 'author'))
    const n = authors().length
    const color = /^#[0-9a-f]{3,8}$/i.test(v.color) ? v.color : /^[0-9a-f]{6}$/i.test(v.color) ? `#${v.color}` : PALETTE[n % PALETTE.length]
    writeConfig({ [`WEEVILS_AUTHOR_${id}`]: `${v.name.replace(/\|/g, ' ')} | ${color} | ${email}` })
    resetAuthors()
    console.log(`[setup] auteur ajouté (${id.toLowerCase()})`)
    const alias = mailConfig()?.address ?? ''
    this.say(chip(t.authorOk(v.name, email, alias), alias ? 'author' : 'mail'))
  }

  // ---------------------------------------------------------------- vers weevboss

  /** Ce que weevilsd a écrit au nom de weevboss depuis sa dernière réponse : un bloc à joindre au message (jamais affiché). */
  contextFor(): string {
    const fresh = this.p.log.filter((m) => m.at > this.p.bossSeenAt)
    this.p.bossSeenAt = Date.now()
    this.save()
    if (!fresh.length) return ''
    const lines = fresh.map((m) => `${m.role === 'user' ? 'user' : 'you'}: ${m.text.replace(/```[a-z]*\n?/g, '`').replace(/\s+/g, ' ').slice(0, 400)}`)
    return ` ⟦weevils — shown in your thread since your last reply (written by weevils in your name, or the user's answers to a setup flow; secrets never shown): ${lines.join(' | ').slice(0, 2400).replace(/⟧/g, ']')}⟧`
  }

  /** « weevils setup » : l'état de chaque brique, les gestes pas encore découverts, les astuces pas encore données. */
  async report(): Promise<string> {
    const s = await this.detect(true)
    const m = s.machine
    const seen = new Set(this.deps.seen())
    const yes = (b: boolean) => (b ? 'yes' : 'no')
    const ago = (id: string) => (this.p.marks[id] ? `${Math.round((Date.now() - this.p.marks[id]) / 3600_000)}h ago` : '')
    const l: string[] = [
      `lang: ${lang()}`,
      `machine: ${m.kind}${m.mac ? ' (mac)' : ''}${m.provider ? ` ${m.provider}` : ''} · ${m.os} · ${m.cpus} cores · ${Math.round(m.ramGb * 10) / 10} GB · room for ~${m.agents} agents · always on: ${m.alwaysOn ?? 'unknown'} · up ${Math.round(m.uptimeDays)} d · host ${m.host} · ssh ${m.sshTarget}`,
      `other machines: ${m.others.join(', ') || 'none'}${m.others.length ? ` (one always on: ${yes(m.othersAlwaysOn)})` : ''}`,
      `access: ${s.reach} ${s.url} · https ${yes(s.https)}`,
      `phone: ${s.phone.devices} device(s) signed in · push on ${s.phone.push} · siri shortcut token: ${yes(s.shortcut)}`,
      `claude code: installed ${yes(s.claude.installed)} · signed in ${yes(s.claude.logged)}`,
      `codex: installed ${yes(s.codex.installed)} · signed in ${yes(s.codex.logged)}`,
      `github: gh installed ${yes(s.github.installed)} · signed in ${yes(s.github.logged)}${s.github.login ? ` (${s.github.login})` : ''}`,
      `voice: spoken ${s.voice.spoken ?? 'none'} · dictation (OpenAI key) ${yes(s.voice.openai)} · https for the mic ${yes(s.voice.https)}`,
      `devil: plugged ${yes(s.devil.plugged)}${s.devil.model ? ` (${s.devil.model})` : ''}`,
      `e-mail bridge: ${s.mail.on ? s.mail.address : 'off'} · allowed authors ${s.mail.authors}`,
      `quota: ${s.quota.join(' · ') || 'unknown'}`,
      `security: agents ask permission ${yes(s.security.safe)} · exposed over plain http ${yes(s.security.exposedHttp)}`,
      `tools: ${Object.entries(s.tools).map(([k, x]) => (k === 'node' ? `node ${x}` : `${k} ${yes(!!x)}`)).join(', ')} · package manager ${s.pkg ?? 'none'} · sudo ${s.sudo}`,
      `projects in the feed: ${s.projects} · weevils clone: ${s.clone}`,
      `proposed already: ${Object.keys(this.p.marks).filter((k) => !k.startsWith('tip:') && !k.startsWith('gesture:')).map((k) => `${k} (${ago(k)})`).join(', ') || 'nothing'}`,
      `gestures not discovered yet: ${GESTURES.filter(([id, h]) => !seen.has(h) && !this.p.marks[`gesture:${id}`]).map(([id, , w]) => `${id} = ${w}`).join(' | ') || 'none'}`,
      `tips not given yet: ${TIPS.filter(([id]) => !this.p.marks[`tip:${id}`]).map(([id, w]) => `${id} = ${w}`).join(' | ') || 'none'}`,
    ]
    return l.join('\n')
  }
}

/** Le texte tel que l'utilisateur l'a tapé, sans le bloc de contexte joint pour weevboss. */
export const withoutContext = (text: string) => text.replace(CONTEXT_BLOCK, '')
