import type { RequestOrigin } from '../shared/api.ts'
import { sendJson } from './http-json.ts'
import { collectionReaders } from './page-collections.ts'
import { markdownFileRoutes } from './markdown-files.ts'
import { proposeThinkLayout } from './think-ai.ts'
import { ThinkStore } from './think.ts'
import { previewTarget } from './preview-target.ts'
import { openSiteFile, siteFile, siteKey, siteKeyOk } from './site.ts'
import { loadTokens, saveTokens as saveDeviceTokens } from './device-tokens.ts'
import { Outbox, OutboxError } from './outbox.ts'
import { executeOutbox, originOf, outboxRoute } from './outbox-http.ts'
import { CaptureTokens, CAPTURE_TTL_MS } from './capture-tokens.ts'
import { bossDoor } from './boss-door.ts'
import OM from './i18n/outbox.ts'
import { rawEngineeringNotice } from '../shared/feed-text.ts'
import FY from './i18n/foryou.ts'
// weevilsd : API + flux temps réel pour l'app, et récepteur local des hooks Claude Code.
// Lancer : node server/index.ts (Node 22, TypeScript natif).

import { execFile, spawn } from 'node:child_process'
import { Awake } from './platform.ts'
import { TunnelFollower, waitServed } from './tunnel-link.ts'
import { claimSetup } from './get-claim.ts'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { CLAUDE_DIR, CODEX_DIR, CONFIG_DIR, CONFIG_FILE, DATA_DIR, MADE_PAGES_DIR, DIST_DIR, NEXT_DIST_DIR, HOME, HOOK_PORT, HOST, INBOX_DIR, KILL_AFTER_MS, MACHINE, ORCHESTRATOR, ORCH_DIR, PORT, PROJECTS_DIR, PROJECT_ROOTS, PUBLIC_URL, setPublicUrl, WEEVBOOK, WEEVBOOK_DIR, CONNECTOR, WEEVBOOK_HUB, THREADS, VAULT_DEPLOY_KEY, VAULT_KEY_FILE, VAULT_STAGING, vaultRemote } from './config.ts'
import { openaiKey, transcribe } from './transcribe.ts'
import { addChunk, clip, cue, finishUpload, logMarks, newShortcutToken, shortcutAuthed, shortcutToken, speakStream, voiceTurn } from './voicepipe.ts'
import { cartesia, cartesiaVoices, claudeAvailable, haiku, ledger, relay as modelRelay } from './fast.ts'
import { CostOptimizer, RUN_EVERY_MS as COST_EVERY_MS } from './cost.ts'
import CostM from './i18n/cost.ts'
import { Weevils, isTestBrief, joinContext, withFiles } from './core.ts'
import { uiChoice, uiDirs, UI_COOKIE } from './ui-choice.ts'
import { lang, requestLang, withLang, setLang, tr, withInstallLang, user, installationLang } from './i18n.ts'
import M from './i18n/api.ts'
import PM from './i18n/pages.ts'
import P from './i18n/push.ts'
import V from './i18n/voice.ts'
import S from './i18n/setup.ts'
import { LoadSampler, tipRoutes } from './tips.ts'
import { Hints, hintRoutes } from './hints.ts'
import { softwareRoutes, softwareCatalog } from './softwares.ts'
import { appWriteAllowed, browserSafe, clientAddress, configureLocalAuth, isLocal, localTokenProblem, parseLocalToken, trustedFrom, trustedSource } from './http.ts'
import { startMailBridge } from './mailbridge.ts'
import { resetAuthors, threadAuthor } from './authors.ts'
import { explain, grepRepo, readExplain } from './explain.ts'
import { brief, detail as infraDetail, listDir, machineInput, readAny, startInfra } from './infra.ts'
import { jailedAllowed, jailedPeer, ownPeer, sameUserPeer } from './jail-peer.ts'
import { answer as machineClaude } from './machine-claude.ts'
import { Hub, hubRoutes, Runner, runnerRoutes } from './heavy/jobs.ts'
import { installShims } from './heavy/shims.ts'
import { setSessionShims } from './mux.ts'
import { loginLimiter } from './login-limit.ts'
import { startDiskUsage } from './disk-usage.ts'
import { anchorFor, entries as spendEntries, logCalibration, summarize } from './spend.ts'
import { TempoService } from './tempo-service.ts'
import { setSpeedModeSource } from './request-handling.ts'
import { isTempoMode, legacyOf } from '../shared/tempo.ts'
import { claudeQuota, claudeWindows, quotas, rate as tokenRate, today as usageToday } from './usage.ts'
import { Relay, defaultDeps } from './relay.ts'
import { ClaudeAccounts, accountsOn, defaultRoot, setAccounts } from './claude-accounts.ts'
import { ProviderHealth } from './provider-health.ts'
import { preferredTool, providerStatus, setProviderRoute } from './provider.ts'
import type { InfraDetail, MachineBrief, MachineFacts, Reach, TokenRate, UsageToday } from '../shared/infra.ts'
import { facts } from './discover.ts'
import { applyKeys, factoryRoutes, keysOff, talkContext, type FactoryDeps } from './your-factory.ts'
import { Setup, installPlan, shellEnv, which, writeConfig } from './setup.ts'
import { followAsk } from './ask-follow.ts'
import { agentsChoice, isAgentMode } from './agent-modes.ts'
import { askPermissions } from './agent-launch.ts'
import { isBrick, isSecretName, isSetupKey, type Device } from '../shared/setup.ts'
import { Memory, memoryRoutes } from './memory.ts'
import { ledgerRoutes } from './boss-ledger-http.ts'
import { weevilRoutes } from './weevil.ts'
import { Optimizers, optimizerRoutes } from './optimizers.ts'
import { Sleep } from './sleep.ts'
import { ThemePref } from './theme-pref.ts'
import { ForYou, foryouRoutes, type MachineState } from './foryou.ts'
import { ForYouNumbers } from './foryou-numbers.ts'
import { serveAttachment } from './attachments.ts'
import { Captures } from './captures.ts'
import CapM from './i18n/captures.ts'
import { MediaShelf } from './foryou-media.ts'
import { Curator } from './foryou-curator.ts'
import { Voices, voiceParam } from './foryou-voice.ts'
import { geminiKey, liveUpgrade, sameOrigin } from './live.ts'
import { changedPieces, KEY_RE as PAGE_KEY_RE, PageRefused, Pages } from './pages.ts'
import { PageBand, pageData, readStylesheet, themeCss } from './page-band.ts'
import { MISC } from './projects.ts'
import { pageLink } from '../shared/pages.ts'
import type { MachineLoad } from '../shared/tips.ts'
import { Bring, realGit } from './bring.ts'
import { HubSync, checkpointHook } from './weevbook/hub.ts'
import { startWeevbookWriter } from './weevbook/writer.ts'
import { startFirstBackfill } from './weevbook/backfill.ts'
import { syncProgress } from './sync-progress.ts'
import { Lab } from './lab.ts'
import { startVaultPusherWhenSet } from './weevbook/vault.ts'
import { ghRunner, shareVault } from './weevbook/vault-github.ts'
import { vaultHere } from './weevbook/vault-cli.ts'
import { vaultSource } from './weevbook/vault-raw.ts'
import { Connector, reposUnder } from './connector/tools.ts'
import { Join, joinRoute, remotesIn } from './join.ts'
import { newProjectFolder } from './project-folder.ts'
import { ConnectorAuth, codeFingerprint } from './connector/oauth.ts'
import { connectorHttp } from './connector/http.ts'
import { startThreads, threadsRoutes, type ThreadsApp } from './threads-app.ts'
import { startMoves } from './moves-app.ts'

const w = new Weevils()
// Claude Code's one-time warning about running without prompts follows the choice from the start: an install that
// never chose runs its agents on their own (server/agent-launch.ts), and the warning would stop their first session.
try {
  followAsk(askPermissions(), { writeConfig, keepSkip: w.modes.anyAuto() })
} catch (e) {
  console.error(`[agents] ${(e as Error).message}`)
}
// The heavy-job queue (server/heavy): the stand-ins that send the sessions' tests and builds through it, first in the
// PATH of every session started from now on; the runner that takes jobs from the user's other machines; on the main
// machine, the hub that sends a busy machine's jobs to an idle one.
void installShims({ dataDir: DATA_DIR, repo: path.resolve(import.meta.dirname, '..'), port: PORT }).then(setSessionShims)
const jobsTrusted = (req: http.IncomingMessage) => isLocal(req) && !jailedPeer(req.socket)
const runner = new Runner()
const hub = new Hub({
  remotes: () => w.remotes,
  name: (id) => w.snapshot().machines.find((m) => m.id === id)?.name ?? id,
  share: () => w.factory.shareJobs !== false,
  off: () => w.factory.machinesOff,
})
// Your factory: API keys turned off stay out of the environment from the start (server/your-factory.ts).
applyKeys(keysOff(w.factory), CONFIG_FILE)
const sourceAuthor = (id: string) => threadAuthor(id, source => w.store.get(source), w.bossConversation(), ORCH_DIR)
/** A signed brief's spoken line: the sender's own (`weevils send|new --say`), else asked of the cheap model at once. */
const saysFor = (text: string, say: unknown) => (typeof say === 'string' && say.trim() ? w.says.given(text, say) : w.says.want(text))
// Bring your conversations (server/bring.ts): another computer's Claude Code and Codex conversations, resumed here.
const bring = new Bring({
  home: HOME, projectsDir: PROJECTS_DIR, roots: PROJECT_ROOTS, claudeDir: CLAUDE_DIR, codexDir: CODEX_DIR,
  codexHome: path.dirname(CODEX_DIR), dataDir: DATA_DIR, git: realGit, remotes: () => w.remotes, bump: () => w.bump(),
})
w.store.broughtAt = bring.broughtAt
w.start()
let threadsApp: ThreadsApp | null = null
let moves: ReturnType<typeof startMoves> | null = null
// The weevbook, in shadow (docs/spec, step 1): on unless WEEVILS_WEEVBOOK=0. It reads the same session files as the
// app, on its own timer, and changes nothing the app shows or does. The first start imports every session of this
// machine once, in a low-priority process (07-vault.md, the import at install). With a vault (WEEVILS_VAULT, or the
// remote `weevils weevbook vault setup` saved), the threads are encrypted and pushed to it as their refs move; a vault
// set up while weevilsd runs (weevboss does it in its chat, a join brings it) starts being pushed within a minute.
// With a hub (WEEVILS_WEEVBOOK_HUB, step 2): each turn's code is checkpointed, threads and checkpoints are pushed to the
// hub every 20 s, and the main machine steals the leases of machines gone silent. Nothing shows in the app either.
// With a vault (07-vault.md, step 3) the code is checkpointed too, and the pusher sends the raw lines, slim, and the
// checkpoints, encrypted. With neither, no checkpoint is taken and nothing leaves, as before.
if (WEEVBOOK) {
  const sessions = path.join(DATA_DIR, 'weevbook-sessions.jsonl')
  const vaultOn = process.env.WEEVILS_VAULT?.trim() !== '0'
  const takeCheckpoint = checkpointHook({ dataDir: DATA_DIR, home: HOME, weevbookGitDir: path.join(WEEVBOOK_DIR, '.git'), log: (l) => console.error(l) })
  startWeevbookWriter({
    dir: WEEVBOOK_DIR, sessions, machine: MACHINE.id, home: HOME, codexDir: CODEX_DIR, roots: PROJECT_ROOTS,
    sources: () => [...w.store.byFile.values()].map((t) => ({ file: t.file, provider: t.tool })),
    // A vault may be set up while weevilsd runs: looked for when a turn ends (two small files).
    ...(WEEVBOOK_HUB ? { checkpoint: takeCheckpoint } : vaultOn ? { checkpoint: async (turn: Parameters<typeof takeCheckpoint>[0]) => (vaultRemote() && fs.existsSync(VAULT_KEY_FILE) ? takeCheckpoint(turn) : null) } : {}),
  })
  console.log(`[weevbook] shadow writer on: ${WEEVBOOK_DIR}`)
  startFirstBackfill({ dataDir: DATA_DIR, log: (l) => console.log(l) })
  if (vaultOn) {
    startVaultPusherWhenSet({ dir: WEEVBOOK_DIR, staging: VAULT_STAGING, remote: () => vaultRemote(), keyFile: VAULT_KEY_FILE, deployKey: VAULT_DEPLOY_KEY, machine: MACHINE.id, gh: which('gh') ?? 'gh', hub: !!WEEVBOOK_HUB, log: (l) => console.error(l) })
  }
  let sync: HubSync | undefined
  if (WEEVBOOK_HUB) {
    sync = new HubSync({ dir: WEEVBOOK_DIR, dataDir: DATA_DIR, sessions, machine: MACHINE.id, hub: WEEVBOOK_HUB, steals: ORCHESTRATOR })
    sync.start()
    console.log(`[weevbook] hub sync on: ${WEEVBOOK_HUB.url}${ORCHESTRATOR ? ' (steals the leases of silent machines)' : ''}`)
  }
  // Moves are agreed (07-vault.md, step 4): `weevils weevbook move | agree` come here, and the machine that serves the
  // app, with a vault and no hub, watches the vault's leases: a machine gone silent makes weevboss ask, in one line.
  const vaultNow = () => (vaultOn ? vaultHere([]) : null)
  moves = startMoves({
    w, machine: MACHINE, dataDir: DATA_DIR, home: HOME, claudeDir: CLAUDE_DIR, codexDir: CODEX_DIR, roots: PROJECT_ROOTS, projectsDir: PROJECTS_DIR,
    ...(WEEVBOOK_HUB ? { hub: WEEVBOOK_HUB } : {}), ...(sync ? { sync } : {}), vault: vaultNow, watch: ORCHESTRATOR && vaultOn && !WEEVBOOK_HUB,
    poke: (thread) => threadsApp?.threads.poke(thread), announce: ORCHESTRATOR, title: (thread) => threadsApp?.topic?.(thread), log: (l) => console.log(l),
  })
  // Threads (step 4): every message goes to the dispatcher, which runs on the machine that serves the app.
  if (sync && THREADS) {
    // A turn the dispatcher gives this machine, for a thread the hub holds no line or checkpoint of: the vault's.
    const vault = () => {
      const v = vaultNow()
      return v ? vaultSource(v) : undefined
    }
    threadsApp = startThreads({ w, sync, machine: MACHINE.id, dispatcher: ORCHESTRATOR, dataDir: DATA_DIR, home: HOME, claudeDir: CLAUDE_DIR, codexDir: CODEX_DIR, roots: PROJECT_ROOTS, projectsDir: PROJECTS_DIR, preferred: preferredTool(), vault, ...(ORCHESTRATOR ? { moves: moves.moves } : {}), log: (l) => console.log(l) })
    w.threadRows = threadsApp.rows
    console.log(`[threads] on${ORCHESTRATOR ? ': this machine runs the dispatcher' : ''}`)
  }
}
startInfra()
startDiskUsage()
// Pont e-mail (agents externes) : sur la machine de l'orchestrateur, seulement si WEEVILS_MAIL_ADDRESS / _PASSWORD sont remplis.
let mailBridge = ORCHESTRATOR ? startMailBridge(w, DATA_DIR) : null
const restartMail = () => {
  mailBridge?.stop()
  mailBridge = ORCHESTRATOR ? startMailBridge(w, DATA_DIR) : null
  mailSeen = mailKeys()
}
// Le pont et les auteurs suivent le fichier de config à chaud : un mot de passe ou un auteur saisi (dans l'app, par
// « weevils config set » ou à la main) les met en route sans redémarrer weevils.
const MAIL_KEY = /^\s*(WEEVILS_(?:MAIL|AUTHOR)_[A-Z0-9_]*)\s*=\s*(.*?)\s*$/
const mailKeys = () => JSON.stringify(Object.entries(process.env).filter(([k]) => /^WEEVILS_(MAIL|AUTHOR)_/.test(k)).sort())
let mailSeen = mailKeys()
let mailFileKeys = new Set<string>()
const readMailKeys = () => {
  const fresh = new Map<string, string>()
  try {
    for (const line of fs.readFileSync(CONFIG_FILE, 'utf8').split('\n')) {
      const m = MAIL_KEY.exec(line)
      if (m) fresh.set(m[1], m[2].replace(/^["']|["']$/g, ''))
    }
  } catch {
    return
  }
  for (const k of mailFileKeys) if (!fresh.has(k)) delete process.env[k]
  for (const [k, v] of fresh) process.env[k] = v
  mailFileKeys = new Set(fresh.keys())
}
readMailKeys()
mailSeen = mailKeys()
fs.watchFile(CONFIG_FILE, { interval: 3000 }, () => {
  // Your factory: a key turned off stays out of the environment, even written again (server/your-factory.ts).
  applyKeys(keysOff(w.factory), CONFIG_FILE)
  readMailKeys()
  if (mailKeys() === mailSeen) return
  resetAuthors()
  console.log('[mail]', 'config changée : pont relu')
  restartMail()
})

// ---------------------------------------------------------------- secret partagé (ce soir) → passkey (demain)

fs.mkdirSync(CONFIG_DIR, { recursive: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
const SECRET_FILE = path.join(CONFIG_DIR, 'secret')
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(9).toString('base64url'), { mode: 0o600 })
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim()
// The machine's local token: what weevils-cli, weevils-update and the main machine of a federation send
// (LOCAL_TOKEN_HEADER) to be trusted without the access code. A 0600 file in DATA_DIR, which an automation's jail
// does not see; server/install.sh may have written it first (same format, one header line).
const LOCAL_TOKEN_FILE = path.join(DATA_DIR, 'local-token')
try {
  fs.writeFileSync(LOCAL_TOKEN_FILE, `X-Weevils-Local: ${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' })
} catch {
  /* already there */
}
fs.chmodSync(LOCAL_TOKEN_FILE, 0o600)
const LOCAL_TOKEN = parseLocalToken(fs.readFileSync(LOCAL_TOKEN_FILE, 'utf8'))
if (!LOCAL_TOKEN) throw new Error(`${LOCAL_TOKEN_FILE}: unreadable local token, delete it and restart weevilsd`) // i18n-ignore: startup error in the service log
configureLocalAuth({ token: LOCAL_TOKEN, jailed: (socket) => jailedPeer(socket) })
/** Saisie tolérante : majuscules, espaces et caractères qui se confondent (0/O, 1/l/I) ne font pas échouer. */
const foldCode = (c: string) => c.replace(/\s+/g, '').toLowerCase().replace(/o/g, '0').replace(/[il]/g, '1')
const sameCode = (a: string, b: string) => {
  const x = crypto.createHash('sha256').update(foldCode(a)).digest()
  const y = crypto.createHash('sha256').update(foldCode(b)).digest()
  return crypto.timingSafeEqual(x, y)
}
// Appareils connectés : un nouveau code d'accès les déconnecte tous (server/device-tokens.ts).
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json')
const tokens = loadTokens(TOKENS_FILE, SECRET)
const saveTokens = () => saveDeviceTokens(TOKENS_FILE, SECRET, tokens)
// Written again at once with this code's mark: a list from before, or the devices of an old code, gone.
try {
  saveTokens()
} catch (e) {
  console.error('[devices]', (e as Error).message)
}

// ---------------------------------------------------------------- accueil et branchements (server/setup.ts)

const hints = new Hints(DATA_DIR)
// Another computer from one line (server/join.ts): its one-time codes, and the key each one lets in.
const join = new Join({
  file: path.join(DATA_DIR, 'join.json'), authorizedKeys: path.join(HOME, '.ssh', 'authorized_keys'), service: path.join(HOME, '.local', 'bin', 'weevils-service'),
  remotes: () => remotesIn(CONFIG_FILE), machineIds: () => w.snapshot().machines.map((m) => m.id),
})
// A machine plugged in from its line: in the list at once (installing), on the port its key may open, kept in
// WEEVILS_REMOTES so its own installer finds it there (no restart); and why, if its install stopped.
const SERVICE_BIN = path.join(HOME, '.local', 'bin', 'weevils-service')
function machineJoined(id: string, port: number) {
  const url = `http://127.0.0.1:${port}`
  const rest = remotesIn(CONFIG_FILE).split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith(`${id}=`))
  writeConfig({ WEEVILS_REMOTES: [...rest, `${id}=${url}`].join(',') })
  w.addRemote(id, url).joined()
  setup.joined(id)
}
function machineJoinFailed(id: string, why: string, fix: string) {
  w.remotes.find((r) => r.id === id)?.failed(why, fix)
  setup.joinFailed(id, why, fix)
}
// Your factory's switch drives another machine's link: off, its tunnel is cut here and its next one waits (weevils-service
// hold, which reads remotes/<id>.off) until it is switched on, which lets it in within a second.
const offFlag = (id: string) => path.join(CONFIG_DIR, 'remotes', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.off`)
function machinePower(id: string, on: boolean) {
  if (id === MACHINE.id || !w.remotes.some((r) => r.id === id)) return
  try {
    if (on) fs.rmSync(offFlag(id), { force: true })
    else {
      fs.mkdirSync(path.dirname(offFlag(id)), { recursive: true, mode: 0o700 })
      fs.writeFileSync(offFlag(id), '')
      execFile(SERVICE_BIN, ['drop', id], { timeout: 15_000 }, () => undefined)
    }
  } catch (e) {
    console.error('[machines] switch:', (e as Error).message)
  }
}
for (const r of w.remotes) machinePower(r.id, !w.factory.machinesOff.includes(r.id))
// The vault for a machine that joins (07-vault.md): its deploy key on the vault's repository, the remote and the key back.
const joinVault = (id: string, pub: string) => shareVault({ remote: vaultRemote(), keyFile: VAULT_KEY_FILE, id, pub, gh: ghRunner(which('gh') ?? 'gh', 20_000), notes: path.join(DATA_DIR, 'vault-machines.json') })
// weevboss creates projects there, and a job handed to a session (weevils do) runs there.
if (ORCHESTRATOR) fs.mkdirSync(PROJECTS_DIR, { recursive: true })
const setup = new Setup({
  bump: () => w.bump(),
  // The person's own projects: weevils' own install (its checkout, or the installation entry) is not one of theirs.
  feed: () => {
    const snap = w.snapshot()
    const mine = snap.projects.filter((p) => p.kind !== 'installation' && p.workstream?.kind !== 'self-improvement')
    return { machines: snap.machines, projects: mine.length, names: mine.map((p) => p.name) }
  },
  remoteFacts: async () => (await Promise.all(w.remotes.filter((r) => r.online).map((r) => r.call<MachineFacts>('GET', '/api/infra/facts').catch(() => null)))).filter((f): f is MachineFacts => !!f),
  // Claude's sign-in on another machine (server/machine-claude.ts): through its tunnel, with its local token.
  machineCall: <T,>(id: string, p: string, body: unknown, timeout: number) => {
    const r = w.remotes.find((x) => x.machineId() === id) ?? w.remotes.find((x) => x.id === id)
    if (!r) throw new Error(`no machine ${id}`) // i18n-ignore: internal, never shown as is
    return r.call<T>('POST', p, body, timeout)
  },
  devices: () => tokens.size,
  push: () => w.push.count,
  shortcut: () => !!shortcutToken(),
  seen: () => hints.get().seen,
  hasHistory: () => w.snapshot().main.some((m) => m.role === 'user'),
  startMail: restartMail,
  handoff: (text, brief) => w.sendMain(text, brief),
  // A session of theirs ended a turn: they have seen weevils work.
  worked: () => w.snapshot().sessions.some((x) => x.status === 'idle' || x.status === 'done'),
  memory: () => w.memory,
  // Turn mode: the memory sits in every turn's view; the thread only hears when it changed.
  bossId: () => (w.bossTurns ? 'turns' : w.bossConversation()),
  delegate: (text, brief) => w.create({ projectId: '', tool: preferredTool(), text: `${text}\n\n${brief}` }),
  connectorOn: () => connectorOn(),
  join: ORCHESTRATOR ? join : undefined,
  // « Ask me first », the onboarding's link: the same global choice as Your factory's.
  askFirst: ORCHESTRATOR ? () => !chooseAgents(true).refused : undefined,
  // The onboarding journey offers its next step only once weevboss's whole thread is quiet (server/journey.ts).
  thread: () => {
    const snap = w.snapshot()
    return { lastAt: snap.main.at(-1)?.at ?? 0, working: !!snap.mainWorking, lastUserAt: snap.main.findLast((m) => m.role === 'user')?.at ?? 0 }
  },
})
w.setup = setup
// The onboarding lab (server/lab.ts): a builder's dev tool, off unless WEEVILS_LAB_DIR is set.
const lab = process.env.WEEVILS_LAB_DIR?.trim() ? new Lab(process.env.WEEVILS_LAB_DIR.trim(), DATA_DIR, () => setup.restep()) : null
if (lab) setInterval(() => void lab.tick(), 2000).unref()

// ---------------------------------------------------------------- mémoire, auto (machine principale)

const memory = new Memory()
memory.onChange(() => w.bump())
const optimizers = new Optimizers(w, memory)
// L'optimiseur de coûts (server/cost.ts) : une automatisation intégrée de la page auto, toutes les 30 min, sans modèle.
const cost = new CostOptimizer({
  snapshot: () => w.snapshot(),
  fileOf: (id) => w.store.get(id)?.file,
  bossId: () => w.bossConversation(),
  command: (id, cmd) => w.command(id, cmd),
  commandMain: (cmd) => w.commandMain(cmd),
  key: (id, key) => w.key(id, key),
  autoTasks: () => optimizers.list(),
  ledger: () => ledger.days(7),
  post: (item) => foryou?.add(item),
})
if (ORCHESTRATOR) {
  w.memory = memory
  w.optimizers = optimizers
  // weevils' own checkout (the recursive signature) when the server runs from one inside the project roots.
  const self = path.basename(path.resolve(import.meta.dirname, '..'))
  const selfRepo = (() => { try { return w.workstreamForRepo(self) ? self : null } catch { return null } })()
  optimizers.registerBuiltin('cost', (now) => cost.run(now), { title: tr(CostM).title, why: tr(CostM).seedWhy, every: COST_EVERY_MS, repo: selfRepo })
  optimizers.start()
}

// ---------------------------------------------------------------- « pour toi » (machine principale, server/foryou.ts)

/** Niveau et disque de chaque machine, pour les alertes du flux : demandés en arrière-plan, jamais sur le chemin d'une requête. */
const machineStates = async (): Promise<MachineState[]> => {
  const here = brief()
  const disk = await fs.promises.statfs(DATA_DIR).then((d) => (d.blocks ? Math.round((1 - d.bavail / d.blocks) * 100) : undefined)).catch(() => undefined)
  const far = await Promise.all(
    w.remotes.filter((r) => r.online).map(async (r): Promise<MachineState | null> => {
      const m = await r.call<{ machines: MachineBrief[] }>('GET', '/api/infra/brief?local=1').then((d) => d.machines[0]).catch(() => null)
      return m ? { id: r.snap?.machines[0]?.id ?? r.id, name: r.snap?.machines[0]?.name ?? r.id, level: m.level } : null
    }),
  )
  return [{ id: here.id, name: here.name, level: here.level, disk }, ...far.filter((m): m is MachineState => !!m)]
}
// La charge de cette machine telle que GET /api/tips la lit (tips-state.json, écrit chaque minute), relue de temps en temps.
let tipLoad: { at: number; loads: MachineLoad[] } = { at: 0, loads: [] }
// La voix de chacun dans le flux : weevboss garde celle de l'app, chaque auteur extérieur a la sienne (server/foryou-voice.ts).
const voices = new Voices({ bossVoice: () => w.voiceId ?? cartesia()?.voice })
const captureLibrary = new Captures(DATA_DIR)
const mediaShelf = new MediaShelf({ file: path.join(DATA_DIR, 'foryou-media.json'), roots: [...PROJECT_ROOTS, INBOX_DIR, DATA_DIR] })
const foryou = ORCHESTRATOR
  ? new ForYou(w, {
      softwares: () => softwareCatalog(w),
      numbers: new ForYouNumbers({ ledgerFile: path.join(DATA_DIR, 'boss', 'ledger.json'), roots: PROJECT_ROOTS, fr: () => installationLang() === 'fr' }),
      shelf: mediaShelf,
      isTestBrief,
      optimizers: () => ({ accept: (id) => optimizers.accept(id) === true, refuse: (id) => optimizers.refuse(id) }),
      tips: (snap, now) => {
        if (now - tipLoad.at > 5 * 60_000) tipLoad = { at: now, loads: [new LoadSampler().local()] }
        return { snap, now, loads: tipLoad.loads, dictation: !!openaiKey(), reapMs: KILL_AFTER_MS }
      },
      quotas,
      machines: machineStates,
      mail: () => mailBridge,
      voiceOf: (who) => voices.of(who),
      op: (op) => cost.op(op),
      // Each session result card's title, from its whole closing message (subscription haiku, ~2 s).
      title: (prompt) => (claudeAvailable() ? haiku(prompt, 45_000) : Promise.resolve('')),
      // The user's own words: context for the stream, never handed back as weevils' idea.
      said: () => memory.list().map((m) => m.text),
    })
  : null
w.foryou = foryou
// ---------------------------------------------------------------- mode sommeil (server/sleep.ts, machine principale)
const sleep = new Sleep(path.join(DATA_DIR, 'sleep.json'))
// The theme, one for every device and address (server/theme-pref.ts).
w.theme = new ThemePref(path.join(DATA_DIR, 'theme.json'))
if (ORCHESTRATOR) {
  w.sleep = sleep
  optimizers.sleep = sleep
  // Asleep: only real blockers reach the phone.
  w.push.asleep = () => sleep.on
  sleep.onChange((on, night, now) => {
    // Stops the runs that end on wake before the recap reads them.
    optimizers.sleepChanged(on, now)
    if (!on && night) foryou?.addRecap(night, optimizers.recapAutos())
    w.bump()
  })
}
// Ce qui est écrit ou compté dans le flux (point de weevboss, idées, « tu savais que », jalons, barres du jour) : une
// seule boucle, sur son propre minuteur, jamais sur le chemin d'une requête (server/foryou-curator.ts).
if (foryou) {
  const curator = new Curator(foryou, {
    deployment: () => {
      try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../dist/build.json'), 'utf8')) } catch { return null }
    },
    memory: () => w.memory,
    repoDir: (repo) => w.repoDir(repo),
    advice: async () => (await infraDetail()).advice,
  })
  foryou.curator = curator
  curator.start()
  // Recent result cards stored before titles existed (or whose title failed): titled once, in the background.
  setTimeout(() => foryou.titleRecentResults(), 15_000).unref?.()
  // And a card left untitled later (a title call that failed, a rewrite at the wrong moment) heals without a restart.
  setInterval(() => foryou.titleRecentResults(2), 10 * 60_000).unref?.()
}
// ---------------------------------------------------------------- relais Codex pendant la limite de Claude (chaque machine, pour ses sessions)

let codexSeen = { at: 0, ok: false }
const codexReady = () => {
  // Turned off in Your factory: never handed work (server/your-factory.ts).
  if (w.factory.intelOff.includes('codex')) return false
  if (Date.now() - codexSeen.at > 30_000) codexSeen = { at: Date.now(), ok: !!which('codex') && fs.existsSync(path.join(path.dirname(CODEX_DIR), 'auth.json')) }
  return codexSeen.ok
}
// Several Claude accounts of the user's own (off unless WEEVILS_CLAUDE_ACCOUNTS=1): tried before the Codex relay.
const claudeAccounts = new ClaudeAccounts({
  root: defaultRoot(HOME), claudeHome: path.join(HOME, '.claude'), claudeJson: path.join(HOME, '.claude.json'),
  mainQuota: claudeQuota, windows: claudeWindows, bin: () => which('claude') ?? 'claude', env: () => shellEnv(),
})
setAccounts(claudeAccounts)
const health = new ProviderHealth(path.join(DATA_DIR, 'provider-health.json'), async () => ({ ...(await quotas()), claude: await claudeAccounts.quota() }), tool => {
  if (w.factory.intelOff.includes(tool)) return false
  const s = providerStatus(tool)
  return s.installed && s.logged
})
const relay = new Relay(w.relayHost(), { ...defaultDeps(() => claudeAccounts.quota(), codexReady), health, ...(accountsOn() ? { accounts: claudeAccounts } : {}) })
// With threads (WEEVILS_THREADS), the dispatcher moves a thread between accounts and providers: no relay runs.
// Tempo (docs/product/tempo.md): the modes per repo and the global ceiling, the spend ledger behind their numbers, and
// the starts of queued requests. The main machine only: it is where weevboss and the request ledger live.
const tempo = ORCHESTRATOR
  ? new TempoService({
      dir: DATA_DIR,
      entries: () => spendEntries(),
      quotas: async () => ({ ...(await quotas()), claude: await claudeAccounts.quota() }),
      machine: machineInput,
      accounts: () => (accountsOn() ? Math.max(1, claudeAccounts.folders().filter((f) => f.logged).length) : 1),
      sessions: () => w.snapshot().sessions,
      projects: () => w.snapshot().projects,
      calibrationFile: process.env.WEEVILS_SPEND_LOG ?? path.join(DATA_DIR, 'spend-calibration.jsonl'),
      calibrate: async () => {
        const q = (await quotas()).claude
        const es = spendEntries()
        const first = summarize(es, q)
        logCalibration(summarize(es, q, Date.now(), anchorFor(first.week.end) ?? undefined), es, q)
      },
    })
  : null
if (tempo) {
  w.tempo = tempo
  setSpeedModeSource(() => legacyOf(tempo.speedMode()))
  const tick = () => void tempo.tick().catch((e) => console.error(`[tempo] ${(e as Error).message}`))
  setTimeout(tick, 20_000).unref()
  setInterval(tick, 10 * 60_000).unref()
}
if (!THREADS) {
  w.relay = relay
  setProviderRoute(tool => relay.executionTool(tool))
  relay.start()
}

const asDevice = (d: any): Device => ({
  os: ['ios', 'android', 'mac', 'windows', 'linux'].includes(d?.os) ? d.os : 'other',
  mobile: !!d?.mobile,
  standalone: !!d?.standalone,
})
/** Le lien de connexion (avec le code), pour le QR de l'accueil : l'adresse publique, sinon celle par laquelle l'app est ouverte. */
const loginLink = (req: http.IncomingMessage) => {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? `127.0.0.1:${PORT}`)
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http')
  return `${(PUBLIC_URL || `${proto}://${host}`).replace(/\/$/, '')}/#k=${SECRET}`
}

// A computer's quick tunnel comes back under a new address after each restart: weevils takes it for every link it
// makes and sends the phone the new login link (server/tunnel-link.ts).
new TunnelFollower({
  file: path.join(DATA_DIR, 'link.log'),
  current: () => PUBLIC_URL,
  adopt: (url) => {
    setPublicUrl(url)
    try { writeConfig({ WEEVILS_PUBLIC_URL: url }) } catch (e) { console.error('[link] config:', (e as Error).message) }
    // The login link the install keeps for the person (install.sh: login-link, mode 600) follows too.
    const kept = path.join(DATA_DIR, 'login-link')
    try { if (fs.existsSync(kept)) fs.writeFileSync(kept, `${url}/#k=${SECRET}\n`, { mode: 0o600 }) } catch { /* kept as it was */ }
  },
  announce: async (url) => {
    await waitServed(url)
    for (let i = 0; i < 20 && !w.push.enabled; i++) await new Promise((r) => setTimeout(r, 500))
    await w.push.send({ title: tr(P).linkTitle, body: tr(P).linkBody(new URL(url).host), url: `${url}/#k=${SECRET}`, tag: 'link', category: 'warning' })
  },
}).start()

const logins = loginLimiter()
/** `weevils capture`: a few minutes of sign-in for a headless browser on this machine (server/capture-tokens.ts). */
const captures = new CaptureTokens()
const cookieToken = (req: http.IncomingMessage) => /(?:^|;\s*)wv=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1]
/** The cookie names a browser signed in with the access code (or claimed by a real browser on this machine). */
const hasDevice = (req: http.IncomingMessage) => {
  const t = cookieToken(req)
  return !!t && (tokens.has(t) || captures.valid(t))
}
/** A browser signed in with the access code, not a capture's short-lived sign-in: only it speaks as the user. */
const hasRealDevice = (req: http.IncomingMessage) => {
  const t = cookieToken(req)
  return !!t && tokens.has(t)
}
const authed = (req: http.IncomingMessage) => isLocal(req) || hasDevice(req)
/** A new device token, as the cookie of this browser. */
const issueDevice = (req: http.IncomingMessage, res: http.ServerResponse) => {
  const t = crypto.randomBytes(24).toString('base64url')
  tokens.add(t)
  saveTokens()
  // Secure seulement derrière HTTPS (Caddy envoie x-forwarded-proto) : sinon le navigateur jetterait le cookie en http simple.
  const secure = req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : ''
  res.setHeader('set-cookie', `wv=${t}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=31536000`)
}

// The connector (docs/spec/05-connector.md, step 5): off unless WEEVILS_CONNECTOR=1. ChatGPT or Claude.ai reaches /mcp
// with a token the person gave it on the consent page (the access code, or this browser signed in). The token opens
// /mcp only: the weevbook's five tools, never /api. Changing the access code drops every connector token.
// weevboss turns it on when the person asks to plug in a chat app (server/setup.ts, brick "connector"): at once, and
// WEEVILS_CONNECTOR=1 in the config keeps it on at the next start.
let connectorAuth: ConnectorAuth | null = null
let connector: ReturnType<typeof connectorHttp> | null = null
function connectorOn() {
  if (connector) return
  connectorAuth = new ConnectorAuth({ file: path.join(DATA_DIR, 'connector.json'), fingerprint: codeFingerprint(SECRET) })
  connector = connectorHttp({
    auth: connectorAuth, publicUrl: () => PUBLIC_URL, hasDevice, limiter: logins, checkCode: (code) => sameCode(code, SECRET),
    tools: new Connector({ dir: WEEVBOOK_DIR, machine: MACHINE.id, projects: reposUnder(PROJECT_ROOTS), ...(threadsApp ? { accept: (thread, m) => threadsApp!.threads.accept(thread, { ...m, source: 'connector' }).then(() => undefined) } : {}) }),
  })
  console.log('[connector] on: /mcp')
}
if (CONNECTOR) connectorOn()

// Who may speak as the user into weevboss's thread: a signed-in browser, never a script on this machine (server/boss-door.ts).
const door = bossDoor({ hasDevice: hasRealDevice, isBossTarget: (id) => w.isBossTarget(id), sourceAuthor, refusal: () => tr(M).bossUserOnly })
/**
 * Who a message to a session comes from (RequestOrigin, core.ts send): the person in the app (originOf), or weevboss
 * relaying the person (`weevils send --for-user`): weevboss's own pane (its runtime thread or its token, never a jailed
 * caller), during a turn the person started from the app or by voice (boss/origins.jsonl). Never read from the words.
 */
function requestOrigin(req: http.IncomingMessage, body: { origin?: unknown; forUser?: unknown }, from: string | undefined): RequestOrigin | undefined {
  const own = originOf(req, body)
  if (own || from !== 'weevboss' || body.forUser !== true) return own
  return isLocal(req) && !jailedPeer(req.socket) && w.bossServingUser() ? 'user' : undefined
}

// ---------------------------------------------------------------- utilitaires

const json = sendJson

const readBody = (req: http.IncomingMessage, limit = 1 << 20) =>
  new Promise<any>((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) {
        reject(new Error(tr(M).bodyTooLarge))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error(tr(M).badJson))
      }
    })
    req.on('error', reject)
  })

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const pathname = url.pathname
  const choice = uiChoice({ cookie: req.headers.cookie, query: url.searchParams.get('ui'), nextBuilt: fs.existsSync(path.join(NEXT_DIST_DIR, 'index.html')), fallback: process.env.WEEVILS_UI })
  // « ?ui=… »: kept for this browser, then the same address without it.
  if (choice.set) {
    url.searchParams.delete('ui')
    res.writeHead(302, { location: `${url.pathname}${url.search}`, 'set-cookie': `${UI_COOKIE}=${choice.set}; Path=/; Max-Age=31536000; SameSite=Lax`, 'cache-control': 'no-store' })
    return void res.end()
  }
  const dirs = uiDirs(choice.ui, { classic: DIST_DIR, next: NEXT_DIST_DIR }, pathname)
  const index = path.join(dirs[0], 'index.html')
  let file = index
  if (pathname !== '/') {
    for (const dir of dirs) {
      const f = path.join(dir, pathname)
      if (f.startsWith(dir + path.sep) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) { file = f; break }
    }
  }
  if (!fs.existsSync(file)) return json(res, 503, { error: tr(M).notBuilt })
  const ext = path.extname(file)
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    // The app is never shown inside another page (clickjacking), and its addresses go nowhere as a Referer.
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    // The page depends on the interface this browser chose.
    ...(file === index ? { vary: 'Cookie' } : {}),
  })
  // The app's page carries this installation's language, for the devices that have picked none.
  if (file === index) return void res.end(withInstallLang(fs.readFileSync(file, 'utf8')))
  fs.createReadStream(file).pipe(res)
}

// ---------------------------------------------------------------- pages statiques des repos (navigateur intégré)

// Une petite appli faite par un agent (index.html, chemins relatifs) s'ouvre dans l'app sans domaine de preview :
// /api/site/<clé>/<repo>/… sert les fichiers du repo (dist/ s'il n'y a pas d'index.html à la racine). La clé (dérivée du
// code d'accès, donnée dans le snapshot) remplace le cookie, que le document isolé ne porte pas ; elle change toutes les
// heures (server/site.ts). La page est servie en bac à sable (CSP sandbox, sans allow-same-origin) : son JavaScript n'a
// pas l'origine de weevils et ne peut pas piloter l'API, même si le repo vient d'ailleurs. Seulement les fichiers du
// repo lui-même, liens symboliques résolus : jamais un fichier caché (.git, .env…) ni rien hors du repo.
const refreshSiteKey = () => {
  const k = siteKey(SECRET)
  if (k === w.siteKey) return
  const first = !w.siteKey
  w.siteKey = k
  if (!first) w.bump()
}
refreshSiteKey()
setInterval(refreshSiteKey, 60_000).unref()
const SITE_RE = /^\/api\/site\/([\w-]{22})\/([\w.@+-]+)(\/.*)?$/

// Living-link pages (server/pages.ts, docs/LINKS.md): /p/<kind>/<slug> for the signed-in, keyed files for the sandbox.
const pages = new Pages({ dataDir: DATA_DIR, secret: SECRET, roots: [...PROJECT_ROOTS, INBOX_DIR] })
pages.collections = collectionReaders({ ledger: () => w.ledger, automations: () => optimizers.recapAutos(), repositories: () => w.allRepos().filter((name) => { try { return fs.existsSync(path.join(w.repoDir(name), '.git')) } catch { return false } }), sessions: () => w.snapshot().sessions })
for (const source of ['requests', 'automations', 'repositories'] as const) {
  try { pages.publishCollection(source, tr(PM)[source]) } catch (e) { console.error('[pages]', source, e) }
}
// The « pages » band (server/page-band.ts): the person's own pages, each built by a conversation in its own folder.
const pageBand = new PageBand({
  dataDir: DATA_DIR,
  root: MADE_PAGES_DIR,
  pages,
  start: (cwd, title, text) => w.create({ projectId: MISC, tool: 'claude', text, title, cwd }),
  url: (p) => `${(PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '')}${p}`,
  local: `http://127.0.0.1:${PORT}`,
  resolve: (id) => w.sessionIdOf(id),
  changed: () => w.bump(),
})
w.pageBand = () => pageBand.list()
let stylesheet: string | null | undefined
pages.extra = (slug, rest) => {
  if (rest !== '/weevils.json' && rest !== '/weevils.css') return undefined
  if (!pageBand.made(slug)) return undefined
  const snap = w.snapshot()
  if (rest === '/weevils.css') return { type: 'text/css; charset=utf-8', body: themeCss(snap.theme, stylesheet === undefined ? (stylesheet = readStylesheet()) : stylesheet) }
  let requests: unknown[] = []
  try { requests = pages.collections.requests?.() ?? [] } catch { /* the ledger is unreadable for now */ }
  return { type: 'application/json', body: JSON.stringify(pageData(snap, requests)) }
}
/** The address of a page, as a link to paste: the public one, else the one this request came by. */
const pageUrl = (req: http.IncomingMessage, p: string) => {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? `127.0.0.1:${PORT}`)
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http')
  return `${(PUBLIC_URL || `${proto}://${host}`).replace(/\/$/, '')}${p}`
}

function serveSite(res: http.ServerResponse, key: string, repo: string, rest: string | undefined) {
  if (!siteKeyOk(SECRET, key)) return json(res, 404, { error: tr(M).unknownRoute })
  let dir: string
  try {
    dir = w.repoDir(repo)
  } catch (e) {
    return json(res, 404, { error: (e as Error).message })
  }
  if (rest === undefined) {
    res.writeHead(302, { location: `/api/site/${key}/${repo}/` })
    return res.end()
  }
  let rel: string
  try {
    rel = decodeURIComponent(rest)
  } catch {
    return json(res, 400, { error: tr(M).unknownRoute })
  }
  if (rel === '/' && !siteFile(dir, '/index.html') && siteFile(dir, '/dist/index.html')) {
    res.writeHead(302, { location: `/api/site/${key}/${repo}/dist/` })
    return res.end()
  }
  const file = siteFile(dir, rel)
  if (!file) return json(res, 404, { error: tr(M).unknownRoute })
  let stream: fs.ReadStream
  try {
    stream = openSiteFile(file)
  } catch {
    return json(res, 404, { error: tr(M).unknownRoute })
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals',
    'x-content-type-options': 'nosniff',
    // The key is in the address: never sent on to what the page loads or links to.
    'referrer-policy': 'no-referrer',
  })
  stream.on('error', () => res.destroy()).pipe(res)
}

// ---------------------------------------------------------------- flux temps réel

const sseClients = new Set<http.ServerResponse>()
w.onChange(() => {
  const data = `event: version\ndata: ${w.version}\n\n`
  for (const res of sseClients) res.write(data)
})
// A heartbeat the app sees (a comment would not reach it): a stream silent longer than this is one the link holds
// back, and the app falls back to asking for the version (src/api.ts).
setInterval(() => {
  for (const res of sseClients) res.write(`event: version\ndata: ${w.version}\n\n`)
}, 25_000)

// ---------------------------------------------------------------- API

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void

const think = new ThinkStore(path.join(DATA_DIR, 'think.json'))
let thinkLayoutBusy = false
const routes: [string, RegExp, Handler][] = [
  ...runnerRoutes(runner, json, jobsTrusted),
  ...(ORCHESTRATOR ? hubRoutes(hub, json, jobsTrusted, () => ({ id: MACHINE.id, name: w.snapshot().machines[0]?.name ?? MACHINE.id })) : []),
  ['POST', /^\/api\/think\/organise$/, async (req,res) => {
    const body=await readBody(req); const board=think.read();
    if(thinkLayoutBusy)return json(res,429,{error:'think_layout_busy'});
    if(body.revision!==board.revision)return json(res,409,{error:'think_conflict'});
    thinkLayoutBusy=true;
    try { json(res,200,await proposeThinkLayout(board,body,!THREADS&&relay.autoOnCodex()?modelRelay:undefined)) } catch { json(res,503,{error:'think_layout_unavailable'}) } finally { thinkLayoutBusy=false }
  }],
  ['GET', /^\/api\/think$/, (_req,res) => json(res,200,think.read())],
  ['PUT', /^\/api\/think$/, async (req,res) => {
    const body=await readBody(req,48 << 20);
    try { const saved=think.write(body);json(res,saved?200:409,saved ?? {error:'think_conflict'}) }
    catch { json(res,400,{error:'think_invalid'}) }
  }],
  // The chat apps connected to the weevbook (docs/spec/05-connector.md): listed, and revoked one by one, by app or all.
  ['GET', /^\/api\/connector$/, (_req, res) => json(res, 200, { enabled: !!connector, grants: connectorAuth?.list() ?? [] })],
  ['DELETE', /^\/api\/connector\/([\w-]+)$/, (_req, res, _url, [what]) => json(res, 200, { revoked: connectorAuth?.revoke(what) ?? 0 })],
  ['GET', /^\/api\/pages$/, (_req, res) => json(res, 200, { pages: pages.list() })],
  // weevils page (weevils-cli): a session or an automation on this machine publishes; never the phone.
  ['POST', /^\/api\/pages$/, async (req, res) => {
    if (!isLocal(req)) return json(res, 403, { error: tr(PM).localOnly })
    const b = await readBody(req)
    const from = trustedFrom(req, b) ?? undefined
    const at = (p: unknown) => path.resolve(typeof b.cwd === 'string' ? b.cwd : process.cwd(), String(p ?? ''))
    try {
      const page = b.build === 'machine' ? pages.publishMachine(from)
        : b.build === 'list' ? pages.publishList({ source: at(b.path), title: b.title, kind: b.kind, from, slug: b.slug })
        : b.build === 'library' ? pages.publishLibrary({ roots: (Array.isArray(b.roots) ? b.roots : [b.path]).map(at), title: b.title, from, slug: b.slug })
        : pages.publish({ path: at(b.path), title: b.title, kind: b.kind, from, slug: b.slug })
      json(res, 200, { slug: page.slug, kind: page.kind, title: page.title, path: page.path, url: pageUrl(req, page.path) })
    } catch (e) {
      json(res, e instanceof PageRefused ? 400 : 500, { error: (e as Error).message })
    }
  }],
  // The pages band (server/page-band.ts): a new page from an idea (the app), a published page joining it or leaving it
  // (weevils page pin / unpin), and when a page's files last changed (its preview reloads).
  ['POST', /^\/api\/pages\/band$/, async (req, res) => {
    const b = await readBody(req)
    try {
      json(res, 200, await pageBand.make(b.idea))
    } catch (e) {
      json(res, e instanceof PageRefused ? 400 : e instanceof OutboxError ? e.status : 500, { error: (e as Error).message })
    }
  }],
  ['POST', /^\/api\/pages\/band\/pin$/, async (req, res) => {
    const b = await readBody(req)
    try {
      json(res, 200, pageBand.add(String(b.slug ?? '')))
    } catch (e) {
      json(res, e instanceof PageRefused ? 404 : 500, { error: (e as Error).message })
    }
  }],
  ['DELETE', /^\/api\/pages\/band\/([a-z0-9-]{1,80})$/, (_req, res, _url, [slug]) => json(res, 200, { ok: pageBand.drop(slug) })],
  ['GET', /^\/api\/pages\/band\/([a-z0-9-]{1,80})\/stamp$/, (_req, res, _url, [slug]) => json(res, 200, { stamp: pageBand.stamp(slug) })],
  ['DELETE', /^\/api\/pages\/([a-z0-9-]{1,80})$/, (req, res, _url, [slug]) => {
    if (!isLocal(req)) return json(res, 403, { error: tr(PM).localOnly })
    const ok = pages.remove(slug)
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: tr(PM).gone })
  }],
  ['GET', /^\/api\/preview\/target$/, (_req,res,url) => {
    const snapshot = w.snapshot()
    json(res,200,previewTarget(snapshot.projects,snapshot.sessions,{projectId:url.searchParams.get('projectId') ?? '',repo:url.searchParams.get('repo') || undefined,sessionId:url.searchParams.get('sessionId') || undefined}))
  }],
  ['POST', /^\/api\/login$/, async (req, res) => {
    const body = await readBody(req)
    // The right code always gets in; wrong ones wait, and are counted per real client address (server/login-limit.ts).
    const answer = logins.attempt(clientAddress(req), typeof body.secret === 'string' && sameCode(body.secret, SECRET))
    if (answer !== 'ok') {
      await new Promise((r) => setTimeout(r, 800))
      return json(res, answer === 'limited' ? 429 : 401, { error: tr(M).wrongCode })
    }
    issueDevice(req, res)
    claimSetup()
    json(res, 200, { ok: true })
  }],
  // A real browser on this machine opened the app without the login link: it becomes a device, so the user can write
  // to weevboss from it. Never a script (no browser user agent) nor an automated browser (navigator.webdriver, headless).
  ['POST', /^\/api\/login\/local$/, async (req, res) => {
    // A browser has no local token: the loopback and browser checks, and a process of this very user (never another
    // account's, never an automation's jail).
    if (!door.localClaimAllowed(req) || jailedPeer(req.socket) || !(await ownPeer(req.socket))) return json(res, 403, { error: tr(M).bossUserOnly })
    if (!hasDevice(req)) issueDevice(req, res)
    json(res, 200, { ok: true })
  }],
  // localClaim: a browser on this machine without a device may claim one (POST /api/login/local decides).
  ['GET', /^\/api\/me$/, (req, res) => json(res, 200, { authed: authed(req), device: hasDevice(req), ...(!hasDevice(req) && door.localClaimAllowed(req) ? { localClaim: true } : {}) })],
  ['POST', /^\/api\/logout$/, (req, res) => {
    const t = cookieToken(req)
    if (t) {
      tokens.delete(t)
      saveTokens()
    }
    res.setHeader('set-cookie', 'wv=; Path=/; Max-Age=0')
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/prefs$/, async (req, res) => {
    const body = await readBody(req)
    // Les autres machines suivent : leurs erreurs et leurs écrans remontent dans l'app. Relayé quand l'app parle
    // (passe par le proxy) ou quand la langue change : deux machines qui se lisent l'une l'autre ne se renvoient
    // pas la requête sans fin (le relais arrive en local et ne change plus rien).
    // chosen : langue choisie dans les réglages de l'app, la seule qui change celle de l'installation (jamais celle
    // d'un navigateur : un weevils installé en anglais reste en anglais ouvert sur un téléphone en français).
    const chosen = body.chosen === true
    const changed = setLang(body.lang, chosen)
    if (changed || !isLocal(req)) for (const r of w.remotes) if (r.online) void r.call('POST', '/api/prefs', { lang: body.lang, chosen }).catch(() => undefined)
    json(res, 200, { ok: true })
  }],
  // A secondary machine follows the main one's permission choice (server/ask-follow.ts): only the main machine sends it,
  // through the tunnel with this machine's local token; never a jailed process. The main machine keeps its own.
  ['POST', /^\/api\/machine\/ask$/, async (req, res) => {
    if (!isLocal(req) || jailedPeer(req.socket)) return json(res, 403, { error: tr(PM).localOnly })
    if (ORCHESTRATOR) return json(res, 409, { error: 'main machine' }) // i18n-ignore: machine-to-machine answer
    const b = await readBody(req)
    if (typeof b?.ask !== 'boolean') return json(res, 400, { error: 'bad request' }) // i18n-ignore: machine-to-machine answer
    const r = followAsk(b.ask, { writeConfig, keepSkip: w.modes.anyAuto() })
    if (r.changed) {
      console.log(`[machine] permission prompts ${r.ask ? 'on' : 'off'}, as on the main machine`)
      w.bump()
    }
    json(res, 200, r)
  }],
  // How agents work, for every machine (Your factory > Intelligence > Agents): on their own (the default) or asking
  // first. Main machine only; the others follow over their link (Remote.followAsk). Letting them work on their own is a
  // signed-in browser's tap only, never a script's or an agent's (server/boss-door.ts); asking first, anyone signed in.
  ['POST', /^\/api\/factory\/agents$/, async (req, res) => {
    if (!ORCHESTRATOR) return json(res, 404, { error: tr(M).unknownRoute })
    const b = await readBody(req)
    if (typeof b?.ask !== 'boolean') return json(res, 400, { error: tr(M).badMode })
    if (!b.ask && !door.speaksForUser(req)) return json(res, 403, { error: tr(M).agentsAppOnly })
    const r = chooseAgents(b.ask)
    if (r.refused) return json(res, 409, { error: tr(M).agentsRoot })
    json(res, 200, { ok: true, agents: agentsChoice() })
  }],
  // A session's own choice (null: back to the global one), from its page; one of another machine is set there
  // (core setAgentMode). Letting it work on its own: as above, a signed-in browser's tap only; on another machine,
  // the main one's call through their link (the way it sends the global choice).
  ['POST', /^\/api\/sessions\/([^/]+)\/agent-mode$/, async (req, res, _u, [raw]) => {
    const b = await readBody(req)
    const mode = b?.mode === null ? null : isAgentMode(b?.mode) ? b.mode : undefined
    if (mode === undefined) return json(res, 400, { error: tr(M).badMode })
    const id = decodeURIComponent(raw)
    const freed = mode === 'auto' || (mode === null && !askPermissions())
    const fromMain = !ORCHESTRATOR && isLocal(req) && !jailedPeer(req.socket)
    if (freed && !door.speaksForUser(req) && !fromMain) return json(res, 403, { error: tr(M).agentsAppOnly })
    json(res, 200, await w.setAgentMode(id, mode))
  }],
  // Claude's sign-in on this secondary machine, driven from weevboss's thread on the main one (server/machine-claude.ts):
  // only the main machine calls it, through the tunnel with this machine's local token; never a jailed process.
  ['POST', /^\/api\/machine\/claude\/(login|code)$/, async (req, res, _url, m) => {
    if (!isLocal(req) || jailedPeer(req.socket)) return json(res, 403, { error: tr(PM).localOnly })
    if (ORCHESTRATOR) return json(res, 409, { error: 'main machine' }) // i18n-ignore: machine-to-machine answer
    const r = await machineClaude(m[0] as 'login' | 'code', await readBody(req).catch(() => ({})), setup.claudeHereDriver())
    json(res, r.status, r.body)
  }],
  // Updates by itself (server/weevils-update, every 20 to 30 minutes when nothing is working): on unless turned off here.
  ['POST', /^\/api\/updates$/, async (req, res) => {
    const b = await readBody(req)
    writeConfig({ WEEVILS_AUTO_UPDATE: b?.on === false ? '0' : '1' })
    w.bump()
    json(res, 200, { on: process.env.WEEVILS_AUTO_UPDATE !== '0' })
  }],
  // Sleep mode: { on, since, last } ; POST { on: boolean }.
  ['GET', /^\/api\/sleep$/, (_req, res) => (w.sleep ? json(res, 200, w.sleep.state()) : json(res, 404, { error: 'sleep_unavailable' }))],
  ['POST', /^\/api\/sleep$/, async (req, res) => {
    const b = await readBody(req).catch(() => ({}))
    if (typeof b?.on !== 'boolean') return json(res, 400, { error: 'sleep_on_boolean' })
    if (!w.sleep) return json(res, 404, { error: 'sleep_unavailable' })
    json(res, 200, w.sleep.set(b.on))
  }],
  // The shared theme: { theme } ; POST { theme } (a theme of the app), every device follows through the snapshot.
  ['GET', /^\/api\/theme$/, (_req, res) => json(res, 200, { theme: w.theme?.get() ?? null })],
  ['POST', /^\/api\/theme$/, async (req, res) => {
    const b = await readBody(req).catch(() => ({}))
    if (!w.theme?.set(b?.theme)) return json(res, 400, { error: 'theme_unknown' })
    w.bump()
    json(res, 200, { theme: w.theme.get() })
  }],
  // An agent's explicit reaction on one of the person's messages (`weevils react`, server/reactions.ts): this machine only.
  ['POST', /^\/api\/react$/, async (req, res) => {
    if (!isLocal(req) || jailedPeer(req.socket)) return json(res, 403, { error: tr(PM).localOnly })
    const b = await readBody(req).catch(() => ({})) as { emoji?: unknown; session?: unknown; message?: unknown; from?: unknown }
    try {
      json(res, 200, await w.react(String(b.emoji ?? ''), { session: typeof b.session === 'string' && b.session ? b.session : undefined, message: typeof b.message === 'string' ? b.message : undefined, by: typeof b.from === 'string' ? b.from : undefined }))
    } catch (e) {
      json(res, 400, { error: (e as Error).message })
    }
  }],
  ['GET', /^\/api\/snapshot$/, (_req, res) => json(res, 200, w.snapshot())],
  ['GET', /^\/api\/version$/, (_req, res) => json(res, 200, { version: w.version })],
  ['GET', /^\/api\/events$/, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write(`event: version\ndata: ${w.version}\n\n`)
    sseClients.add(res)
    _req.on('close', () => sseClients.delete(res))
  }],
  ['GET', /^\/api\/sessions\/([^/]+)$/, async (_req, res, _u, [id]) => {
    const d = await w.detailAny(decodeURIComponent(id))
    d ? json(res, 200, d) : json(res, 404, { error: tr(M).sessionNotFound })
  }],
  ['GET', /^\/api\/sessions\/([^/]+)\/subagents\/([^/]+)$/, async (_req, res, _u, [id, subId]) => {
    const d = await w.subagentAny(decodeURIComponent(id), decodeURIComponent(subId))
    d ? json(res, 200, d) : json(res, 404, { error: tr(M).subagentNotFound })
  }],
  ['GET', /^\/api\/sessions\/([^/]+)\/screen$/, async (_req, res, _u, [id]) => json(res, 200, { screen: await w.screen(decodeURIComponent(id)) })],
  ['POST', /^\/api\/sessions\/([^/]+)\/send$/, async (req, res, u, [id]) => {
    const body = await readBody(req)
    door.guard(req, u.pathname, body)
    // « from » (weevils, ou un auteur déclaré) n'est accepté que d'une requête locale (l'orchestrateur, la commande weevils), jamais du téléphone.
    const from = trustedFrom(req, body, sourceAuthor)
    // A signed brief: the thread shows its spoken line (--say), or one written for it (server/brief-says.ts).
    if (from) saysFor(String(body.text ?? ''), body.say)
    json(res, 200, await w.send(decodeURIComponent(id), String(body.text ?? ''), from, trustedSource(req,body,sourceAuthor), requestOrigin(req, body, from), body.safeResume === true))
  }],
  ['POST', /^\/api\/sessions\/([^/]+)\/attach$/, async (req, res, u, [id]) => {
    const body = await readBody(req, 24 << 20)
    door.guard(req, u.pathname, body)
    const files = Array.isArray(body.files) ? body.files.filter((f: any) => typeof f?.data === 'string').map((f: any) => ({ name: String(f.name ?? 'photo'), type: String(f.type ?? 'image/jpeg'), data: String(f.data) })) : []
    json(res, 200, await w.attach(decodeURIComponent(id), String(body.text ?? ''), files, originOf(req, body)))
  }],
  ['GET', /^\/api\/voices$/, async (_req, res) => json(res, 200, cartesia() ? { enabled: true, voices: await cartesiaVoices(), current: w.voiceId } : { enabled: false, voices: [] })],
  ['POST', /^\/api\/voices$/, async (req, res) => {
    w.setVoice(String((await readBody(req)).id ?? '') || undefined)
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/devil$/, async (req, res) => json(res, 200, await w.devil(String((await readBody(req)).text ?? '')))],
  // ---- Accueil et branchements : weevboss guide dans son fil (server/setup.ts, src/ui/setup.tsx).
  ['GET', /^\/api\/setup$/, async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end((await setup.report()) + '\n')
  }],
  ['GET', /^\/api\/setup\/install$/, async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(installPlan(await setup.detect(true)) + '\n')
  }],
  ['POST', /^\/api\/setup\/welcome$/, async (req, res) => {
    const mid = await setup.welcome(asDevice((await readBody(req)).device))
    json(res, 200, { ok: true, ...(mid ? { mid } : {}) })
  }],
  ['POST', /^\/api\/setup\/provider$/, async (req, res) => {
    const b = await readBody(req)
    if (b.tool !== 'claude' && b.tool !== 'codex') return json(res, 400, { error: tr(S).badBrick })
    const flow = await setup.chooseProvider(b.tool, b.device ? asDevice(b.device) : undefined)
    json(res, 200, { ok: true, flow, said: setup.lastSaid ?? undefined, open: setup.takeOpen() })
  }],
  ['POST', /^\/api\/setup\/ask$/, async (req, res) => {
    const b = await readBody(req)
    if (!isBrick(b.brick)) return json(res, 400, { error: tr(S).badBrick })
    const again = b.again === true && (b.brick === 'claude' || b.brick === 'codex')
    // Another computer's line, with what to bring of its history (weevils setup ask machine --since … | --match …).
    const bring = b.brick === 'machine' ? { since: typeof b.since === 'string' ? b.since : undefined, match: typeof b.match === 'string' ? b.match : undefined } : {}
    // Claude's sign-in on another machine of yours (weevils setup ask claude <machine>): its link, its code pasted here.
    if (b.brick === 'claude' && typeof b.machine === 'string' && b.machine && b.machine !== MACHINE.id) {
      if (!(await setup.claudeOn(b.machine))) return json(res, 400, { error: tr(S).badBrick })
      return json(res, 200, { ok: true, flow: false, said: setup.lastSaid ?? undefined, open: setup.takeOpen() })
    }
    const flow = await setup.ask(b.brick, b.device ? asDevice(b.device) : undefined, again, bring)
    json(res, 200, { ok: true, flow, said: setup.lastSaid ?? undefined, open: setup.takeOpen() })
  }],
  // The onboarding's sync line (« 120 of 340 synced »): how many of this machine's conversations are in the vault.
  ['GET', /^\/api\/setup\/sync$/, async (_req, res) => {
    json(res, 200, await syncProgress())
  }],
  // A link in weevboss's words (/#do=github | codex | server | later | recovery | tour… | try.<example>): what the person tapped.
  ['POST', /^\/api\/setup\/do$/, async (req, res) => {
    const b = await readBody(req)
    if (typeof b.action !== 'string') return json(res, 400, { error: tr(S).badBrick })
    // An example to try speaks to weevboss as the person: a signed-in browser's tap only (server/boss-door.ts).
    if (b.action.startsWith('try.') && !door.speaksForUser(req)) return json(res, 403, { error: tr(M).bossUserOnly })
    const ok = await setup.act(b.action, b.device ? asDevice(b.device) : undefined)
    json(res, ok ? 200 : 400, ok ? { ok: true, said: setup.lastSaid ?? undefined } : { error: tr(S).badBrick })
  }],
  // The onboarding lab (server/lab.ts), off unless WEEVILS_LAB_DIR is set: the remarks and what changed, a remark, undo/keep/reset.
  ['GET', /^\/api\/lab$/, async (_req, res) => json(res, 200, lab ? lab.state() : { on: false, items: [] })],
  ['POST', /^\/api\/lab\/remark$/, async (req, res) => {
    if (!lab) return json(res, 404, { error: 'off' }) // i18n-ignore: a dev tool's answer, never shown
    const b = await readBody(req, 48 << 20)
    const text = typeof b.text === 'string' ? b.text : ''
    const files = Array.isArray(b.files) ? b.files : []
    // Captures come as their path in the library ((photo: /…) in the words), files as themselves.
    const pictures = [
      ...[...text.matchAll(/\(photo\s*:\s*(\/[^)\n]+)\)/g)].map((m) => m[1].trim()).filter((f) => f.startsWith(HOME + '/') && fs.existsSync(f)).map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) })),
      ...files.filter((f: { data?: unknown }) => typeof f?.data === 'string').map((f: { name?: string; data: string }) => ({ name: String(f.name ?? 'file.png'), data: Buffer.from(f.data, 'base64') })),
    ]
    const words = text.replace(/\(photo\s*:\s*\/[^)\n]+\)/g, '').replace(/⟦[^⟧]*⟧/g, '').trim()
    if (!words && !pictures.length) return json(res, 400, { error: 'empty' }) // i18n-ignore: a dev tool's answer, never shown
    const context = Array.isArray(b.context) ? b.context.filter((x: unknown) => typeof x === 'string').map((x: string) => x.slice(0, 1500)) : []
    json(res, 200, { ok: true, id: lab.remark(words, context, pictures) })
  }],
  ['POST', /^\/api\/lab\/(undo|keep|reset)$/, async (req, res, _url, m) => {
    if (!lab) return json(res, 404, { error: 'off' }) // i18n-ignore: a dev tool's answer, never shown
    const b = await readBody(req)
    lab.request(m[0] as 'undo' | 'keep' | 'reset', typeof b.id === 'string' ? b.id : undefined)
    json(res, 200, { ok: true })
  }],
  // « weevils setup github »: GitHub's device sign-in, its code and link said in weevboss's thread. From the machine only.
  ['POST', /^\/api\/setup\/github$/, async (req, res) => {
    if (!isLocal(req)) return json(res, 403, { error: tr(S).localOnly })
    json(res, 200, { ok: true, state: await setup.githubDevice(), said: setup.lastSaid ?? undefined })
  }],
  ['POST', /^\/api\/setup\/apply$/, async (req, res) => {
    const b = await readBody(req, 64 << 10)
    if (!isBrick(b.brick) || typeof b.values !== 'object' || !b.values) return json(res, 400, { error: tr(S).badBrick })
    await setup.apply(b.brick, Object.fromEntries(Object.entries(b.values as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])))
    json(res, 200, { ok: true, said: setup.lastSaid ?? undefined })
  }],
  // Un secret demandé par un agent : la valeur ne fait que passer (jamais renvoyée, jamais journalisée).
  ['POST', /^\/api\/setup\/key$/, async (req, res) => {
    const b = await readBody(req, 16 << 10)
    if (!isSecretName(b.name) || typeof b.value !== 'string') return json(res, 400, { error: tr(S).badKey })
    setup.saveKey(b.name, b.value)
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/setup\/done$/, async (req, res) => {
    const b = await readBody(req)
    if (!isBrick(b.brick)) return json(res, 400, { error: tr(S).badBrick })
    setup.done(b.brick)
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/setup\/mark$/, async (req, res) => {
    const id = String((await readBody(req)).id ?? '')
    if (!/^[a-z][a-zA-Z0-9:-]{0,40}$/.test(id)) return json(res, 400, { error: tr(S).badBrick })
    setup.mark(id)
    json(res, 200, { ok: true })
  }],
  // « weevils capture » : a short-lived sign-in for a headless browser, so an agent records the app without ever
  // reading the access code. Local only; it never speaks as the user (boss door) and lapses in minutes.
  ['POST', /^\/api\/capture\/token$/, async (req, res) => {
    if (!isLocal(req)) return json(res, 403, { error: tr(S).localOnly })
    json(res, 200, { token: captures.mint(), ttl: CAPTURE_TTL_MS })
  }],
  // « weevils config set » : seulement depuis la machine (weevboss), seulement les clés prévues.
  ['POST', /^\/api\/setup\/config$/, async (req, res) => {
    const b = await readBody(req)
    if (!isLocal(req)) return json(res, 403, { error: tr(S).localOnly })
    if (!isSetupKey(b.key)) return json(res, 400, { error: tr(S).badKey })
    writeConfig({ [b.key]: String(b.value ?? '') })
    w.bump()
    json(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/setup\/qr\.svg$/, async (req, res) => {
    const svg = await new Promise<string>((resolve) => {
      const p = spawn(which('qrencode') ?? 'qrencode', ['-t', 'SVG', '-m', '1', '-o', '-', loginLink(req)], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      p.stdout.on('data', (c) => (out += c))
      p.on('error', () => resolve(''))
      p.on('close', (code) => resolve(code === 0 ? out : ''))
    })
    if (!svg) return json(res, 404, { error: tr(S).noQr })
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' })
    res.end(svg)
  }],
  ['GET', /^\/api\/setup\/link$/, async (req, res) => json(res, 200, { link: loginLink(req) })],
  // ---- Voix rapide : son en flux, accroches en cache, enregistrement envoyé en morceaux, mesures.
  ['GET', /^\/api\/speak\/stream$/, async (_req, res, url) => {
    const text = url.searchParams.get('text') ?? ''
    if (rawEngineeringNotice('', text)) return json(res, 400, { error: tr(FY).technicalPost })
    return speakStream(res, text, url.searchParams.get('oral') === '1', voiceParam(url.searchParams.get('voice')))
  }],
  ['GET', /^\/api\/voice\/cue$/, async (_req, res) => {
    const mp3 = await cue(w.voiceId, w.speakerLang())
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': mp3.length, 'cache-control': 'no-store' })
    res.end(mp3)
  }],
  ['POST', /^\/api\/voice\/chunk$/, async (req, res) => {
    const b = await readBody(req, 8 << 20)
    addChunk(String(b.id), Number(b.seq), String(b.type ?? 'audio/mp4'), String(b.data ?? ''))
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/voice\/finish$/, async (req, res) => {
    const b = await readBody(req)
    json(res, 200, { text: await finishUpload(String(b.id), b.lang, b.expectedChunks) })
  }],
  ['POST', /^\/api\/voice\/marks$/, async (req, res) => {
    logMarks((await readBody(req)) as Record<string, number>)
    json(res, 200, { ok: true })
  }],
  // ---- Siri / bouton Action : jeton personnel, un tour de parole complet avec le vrai weevboss.
  ['GET', /^\/api\/voice\/shortcut$/, (_req, res) => json(res, 200, { token: shortcutToken(), url: process.env.WEEVILS_SHORTCUT_URL ?? '' })],
  ['POST', /^\/api\/voice\/shortcut$/, (_req, res) => json(res, 200, { token: newShortcutToken(), url: process.env.WEEVILS_SHORTCUT_URL ?? '' })],
  ['POST', /^\/api\/voice\/turn$/, async (req, res) => json(res, 200, await voiceTurn(w, await readBody(req, 16 << 20)))],
  ['GET', /^\/api\/voice\/clip\/([\w-]+)\.mp3$/, (_req, res, _u, [id]) => {
    const mp3 = clip(id)
    if (!mp3) return json(res, 404, { error: tr(M).clipExpired })
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': mp3.length, 'cache-control': 'no-store' })
    res.end(mp3)
  }],
  ['GET', /^\/api\/transcribe$/, (_req, res) => json(res, 200, { enabled: !!openaiKey() })],
  ['POST', /^\/api\/transcribe$/, async (req, res) => {
    const body = await readBody(req, 24 << 20)
    if (typeof body.data !== 'string' || !body.data) return json(res, 400, { error: tr(V).missingAudio })
    json(res, 200, { text: await transcribe(Buffer.from(body.data, 'base64'), String(body.type ?? 'audio/mp4'), body.lang) })
  }],
  ['POST', /^\/api\/sessions\/([^/]+)\/key$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    await w.key(decodeURIComponent(id), String(body.key ?? ''))
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/sessions$/, async (req, res) => {
    const body = await readBody(req)
    const tool = body.tool === 'codex' ? 'codex' : 'claude'
    if (trustedFrom(req, body, sourceAuthor)) saysFor(String(body.text ?? ''), body.say)
    json(
      res,
      200,
      await w.create({
        projectId: String(body.projectId ?? ''),
        repo: body.repo ? String(body.repo) : undefined,
        tool,
        text: String(body.text ?? ''),
        machineId: body.machineId ? String(body.machineId) : undefined,
        ...(typeof body.title === 'string' && body.title.trim() ? { title: body.title } : {}),
        from: trustedFrom(req, body, sourceAuthor),
        sourceThreadId: trustedSource(req,body,sourceAuthor),
      }),
    )
  }],
  // « weevils project new <name> » : the folder of a new project, with git (server/project-folder.ts).
  ['POST', /^\/api\/projects\/new$/, async (req, res) => {
    const name = String((await readBody(req)).name ?? '')
    try {
      const r = newProjectFolder(PROJECTS_DIR, name)
      json(res, 200, { dir: r.dir.startsWith(HOME + path.sep) ? '~' + r.dir.slice(HOME.length) : r.dir, existed: r.existed })
    } catch {
      json(res, 400, { error: tr(S).badProject(name.slice(0, 80)) })
    }
  }],
  ['GET', /^\/api\/boss$/, async (_req, res) => json(res, 200, w.bossStatus())],
  ['GET', /^\/api\/boss\/recall\/([^/]+)$/, async (_req, res, _u, [id]) => {
    const text = w.bossRecall(decodeURIComponent(id))
    json(res, text === null ? 404 : 200, text === null ? { error: tr(M).unknownRoute } : { text })
  }],
  ['POST', /^\/api\/main$/, async (req, res, u) => {
    const body = await readBody(req)
    door.guard(req, u.pathname, body)
    // A signed post (an agent, the weevils command) keeps its author, also when the outbox replays it.
    const { text, origin } = door.text(req, body)
    json(res, 200, await w.sendMain(text, undefined, origin))
  }],
  ['GET', /^\/api\/sessions\/([^/]+)\/model-controls$/, async (_req,res,_u,[id]) => json(res,200,await w.modelControls(decodeURIComponent(id)))],
  ['POST', /^\/api\/sessions\/([^/]+)\/model-controls$/, async (req,res,_u,[id]) => json(res,200,await w.modelControls(decodeURIComponent(id),await readBody(req)))],
  ['GET', /^\/api\/main\/model-controls$/, async (_req,res) => json(res,200,await w.modelControls('__main'))],
  ['POST', /^\/api\/main\/model-controls$/, async (req,res) => json(res,200,await w.modelControls('__main',await readBody(req)))],
  ['POST', /^\/api\/sessions\/([^/]+)\/command$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    json(res, 200, await w.command(decodeURIComponent(id), String(body.command ?? '')))
  }],
  ['POST', /^\/api\/main\/command$/, async (req, res) => {
    const body = await readBody(req)
    json(res, 200, await w.commandMain(String(body.command ?? '')))
  }],
  ['GET', /^\/api\/attachments$/, (_req, res, url) => {
    serveAttachment(res, url.searchParams.get('path') ?? '', [INBOX_DIR, path.join(DATA_DIR, 'inbox'), captureLibrary.dir])
  }],
  // The app's camera (next/src/camera.tsx, server/captureLibrary.ts): the library, newest first, searchable.
  ['GET', /^\/api\/captures$/, (_req, res, url) => {
    const p = url.searchParams
    json(res, 200, { dir: captureLibrary.dir, captures: captureLibrary.list({ q: p.get('q') ?? undefined, group: p.get('group') ?? undefined, tag: p.get('tag') ?? undefined, limit: Number(p.get('limit')) || undefined }) })
  }],
  // One capture: kept in the library, then handed back with the message to send (its thumbnail and what it shows).
  // The app sends that message itself, through its usual door and outbox, to weevboss or the open session.
  ['POST', /^\/api\/captures$/, async (req, res) => {
    const body = await readBody(req, 24 << 20)
    let c
    try { c = captureLibrary.save(body) } catch { return json(res, 400, { error: tr(CapM).notImage }) }
    const to = typeof body.to === 'string' ? body.to : ''
    const session = to && to !== 'weevboss' ? w.snapshot().sessions.find((s) => s.id === to) : undefined
    const message = withFiles(String(body.text ?? ''), [{ path: c.file, image: true }]) + joinContext('', tr(CapM).note(c, captureLibrary.dir))
    // A session on another machine cannot open this file: the app sends the picture itself there (its attach route).
    json(res, 200, { id: c.id, file: c.file, message, note: tr(CapM).note(c, captureLibrary.dir), here: !session || session.machineId === MACHINE.id })
  }],
  ['POST', /^\/api\/main\/attach$/, async (req, res, u) => {
    const body = await readBody(req, 48 << 20)
    door.guard(req, u.pathname, body)
    const { text, origin } = door.text(req, body)
    const files = Array.isArray(body.files) ? body.files.filter((f: any) => typeof f?.data === 'string').map((f: any) => ({ name: String(f.name ?? ''), type: String(f.type ?? ''), data: String(f.data) })) : []
    json(res, 200, await w.attachMain(text, files, origin))
  }],
  ['POST', /^\/api\/import$/, (req, res) => receiveImport(req, res)],
  ['POST', /^\/api\/bring\/link$/, (_req, res) => json(res, 200, { code: bring.link() })],
  ['GET', /^\/api\/bring$/, async (_req, res) => json(res, 200, await bring.view())],
  ['POST', /^\/api\/bring$/, async (req, res) => {
    const body = await readBody(req)
    json(res, 200, bring.request(String(body.source ?? ''), String(body.key ?? '')))
  }],
  ['GET', /^\/api\/bring\/local$/, (_req, res) => json(res, 200, bring.local())],
  ['GET', /^\/api\/bring\/local\/file$/, (_req, res, url) => bring.sendLocal(url.searchParams.get('key') ?? '', res)],
  ['GET', /^\/api\/push$/, (_req, res) => json(res, 200, { enabled: w.push.enabled, publicKey: w.push.publicKey, devices: w.push.count })],
  ['POST', /^\/api\/push\/subscribe$/, async (req, res) => {
    w.push.subscribe((await readBody(req)) as any)
    json(res, 200, { ok: true, devices: w.push.count })
  }],
  ['POST', /^\/api\/push\/test$/, async (_req, res) => {
    await w.push.send({ title: 'weevboss', body: tr(P).testBody, url: '/', tag: 'test' })
    json(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/conversations$/, (_req, res, url) =>
    json(res, 200, { conversations: w.conversationList({ projectId: url.searchParams.get('project') ?? undefined, q: url.searchParams.get('q') ?? undefined }) })],
  ['GET', /^\/api\/conversations\/([^/]+)$/, (_req, res, _u, [id]) => {
    const d = w.conversationDetail(decodeURIComponent(id))
    d ? json(res, 200, d) : json(res, 404, { error: tr(M).conversationNotFound })
  }],
  ['POST', /^\/api\/conversations\/([^/]+)\/classify$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    w.classifyManually(decodeURIComponent(id), { projectId: body.projectId ? String(body.projectId) : undefined })
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/conversations\/([^/]+)\/continue$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    json(res, 200, await w.continueConversation(decodeURIComponent(id), body.tool === 'codex' ? 'codex' : 'claude', String(body.text ?? '')))
  }],
  ['POST', /^\/api\/h24\/([^/]+)\/toggle$/, async (_req, res, _u, [id]) => {
    await w.toggleH24(decodeURIComponent(id))
    json(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/repos$/, async (_req, res, url) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    json(res, 200, remote ? await remote.call('GET', '/api/repos') : { repos: w.allRepos(), mothers: w.motherRepos() })
  }],
  ['GET', /^\/api\/repos\/([^/]+)\/files$/, async (_req, res, url, [repo]) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    json(res, 200, remote ? await remote.call('GET', `/api/repos/${repo}/files`) : { files: await w.files(decodeURIComponent(repo)) })
  }],
  ...markdownFileRoutes(w, json, readBody),
  ['GET', /^\/api\/repos\/([^/]+)\/grep$/, async (_req, res, url, [repo]) => json(res, 200, { hits: await grepRepo(w, decodeURIComponent(repo), url.searchParams.get('q') ?? '') })],
  // Vue d'un fichier : explique, où c'est utilisé, demande (haiku, avec le contexte de la page).
  ['POST', /^\/api\/explain$/, async (req, res) => json(res, 200, await explain(w, readExplain(await readBody(req))))],
  ['GET', /^\/api\/github\/repos$/, async (_req, res, url) => json(res, 200, { repos: await w.githubRepos(url.searchParams.has('fresh')) })],
  ['POST', /^\/api\/github\/repos$/, async (req, res) => {
    const body = await readBody(req)
    json(res, 200, await w.newRepo(String(body.name ?? '').trim(), String(body.description ?? '')))
  }],
  ['POST', /^\/api\/sessions\/([^/]+)\/archive$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    json(res, 200, w.archive(decodeURIComponent(id), body.archived !== false))
  }],
  ['POST', /^\/api\/sessions\/([^/]+)\/close$/, async (_req, res, _u, [id]) => json(res, 200, await w.close(decodeURIComponent(id)))],
  // Session coupée en plein travail : la reprendre (--resume + message de reprise) ou la laisser.
  ['POST', /^\/api\/sessions\/([^/]+)\/resume$/, async (_req, res, _u, [id]) => json(res, 200, await w.resume(decodeURIComponent(id)))],
  ['POST', /^\/api\/sessions\/([^/]+)\/dismiss$/, async (_req, res, _u, [id]) => json(res, 200, await w.dismiss(decodeURIComponent(id)))],
  // ---- Relais Codex pendant la limite de Claude (server/relay.ts) : réglage, plan demandé pour une session, décision sur un plan.
  ['POST', /^\/api\/relay$/, async (req, res) => {
    if (THREADS) return json(res, 404, { error: 'no relay' }) // i18n-ignore: the app never calls it with threads on
    const body = await readBody(req)
    relay.set({ mode: body.mode, switchAt: body.switchAt, tz: body.tz })
    // Les autres machines suivent le réglage (pas le fuseau : relayé seulement quand l'app parle, jamais en boucle).
    if (!isLocal(req) && (body.mode !== undefined || body.switchAt !== undefined)) for (const r of w.remotes) if (r.online) void r.call('POST', '/api/relay', { mode: body.mode, switchAt: body.switchAt }).catch(() => undefined)
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/sessions\/([^/]+)\/relay$/, async (_req, res, _u, [raw]) => {
    if (THREADS) return json(res, 404, { error: 'no relay' }) // i18n-ignore: the app never calls it with threads on
    const id = decodeURIComponent(raw)
    const remote = w.remoteFor(id)
    json(res, 200, remote ? await remote.call('POST', `/api/sessions/${encodeURIComponent(id)}/relay`, {}) : relay.request(id))
  }],
  ['POST', /^\/api\/relay\/plans\/([^/]+)$/, async (req, res, _u, [raw]) => {
    if (THREADS) return json(res, 404, { error: 'no relay' }) // i18n-ignore: the app never calls it with threads on
    const id = decodeURIComponent(raw)
    const body = await readBody(req)
    const call = { action: String(body.action ?? ''), text: typeof body.text === 'string' ? body.text : undefined }
    if (id === 'all') {
      // A successful reply means every participating machine accepted its decision.
      // Skip machines with no request; never disguise a real failure as success.
      const pending = (plans: ReturnType<typeof relay.view>['plans']) => plans.some((p) => !p.resolved && (p.state === 'ready' || p.state === 'failed' || p.state === 'preparing'))
      const decisions: Promise<unknown>[] = []
      if (pending(relay.view().plans)) decisions.push(relay.decide('all', call.action, call.text))
      if (!isLocal(req)) for (const r of w.remotes) if (r.online && pending(r.snap?.relay?.plans ?? [])) decisions.push(r.call('POST', '/api/relay/plans/all', call))
      if (!decisions.length) decisions.push(relay.decide('all', call.action, call.text))
      await Promise.all(decisions)
      return json(res, 200, { ok: true })
    }
    const remote = w.remoteFor(id)
    json(res, 200, remote ? await remote.call('POST', `/api/relay/plans/${encodeURIComponent(id)}`, call) : await relay.decide(id, call.action, call.text))
  }],
  // ---- Coin infrastructure : machines, système de fichiers complet, abonnements.
  ['GET', /^\/api\/infra\/brief$/, async (_req, res, url) => {
    const here = brief()
    if (url.searchParams.has('local')) return json(res, 200, { machines: [here] })
    const far = await Promise.all(
      w.remotes.map(async (r): Promise<MachineBrief> => {
        const id = r.snap?.machines[0]?.id ?? r.id
        const name = r.snap?.machines[0]?.name ?? r.id
        const off = { id, name, online: false, cpu: 0, mem: 0, level: 'ok' as const, weevboss: false }
        if (!r.online) return off
        try {
          const m = (await r.call<{ machines: MachineBrief[] }>('GET', '/api/infra/brief?local=1')).machines[0]
          return { ...m, id, name, online: true }
        } catch {
          // Un weevilsd plus ancien, sans /api/infra : en ligne, sans mesures.
          return { ...off, online: true }
        }
      }),
    )
    json(res, 200, { machines: [here, ...far] })
  }],
  ['GET', /^\/api\/infra\/facts$/, async (_req, res) => json(res, 200, await facts())],
  ['GET', /^\/api\/infra$/, async (_req, res, url) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    if (url.searchParams.has('local') || !remote) {
      const sessions = new Map(w.snapshot().sessions.map((s) => [s.id, s]))
      const d = await infraDetail((id) => sessions.get(id))
      if (url.searchParams.has('local')) return json(res, 200, d)
      return json(res, 200, { ...d, reach: await reachOf(d.facts, MACHINE.id) })
    }
    const d = await remote.call<InfraDetail>('GET', '/api/infra?local=1')
    json(res, 200, { ...d, reach: await reachOf(d.facts, d.id) })
  }],
  ['GET', /^\/api\/fs$/, async (_req, res, url) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    const p = url.searchParams.get('path') ?? '/'
    json(res, 200, remote ? await remote.call('GET', `/api/fs?path=${encodeURIComponent(p)}`) : listDir(p))
  }],
  ['GET', /^\/api\/fs\/file$/, async (_req, res, url) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    const p = url.searchParams.get('path') ?? ''
    json(res, 200, remote ? await remote.call('GET', `/api/fs/file?path=${encodeURIComponent(p)}`) : readAny(p))
  }],
  ['GET', /^\/api\/usage$/, async (_req, res) => json(res, 200, await quotas())],
  ['GET', /^\/api\/usage\/rate$/, async (_req, res, url) => {
    const r = tokenRate()
    if (url.searchParams.has('local')) return json(res, 200, r)
    // Les autres machines s'ajoutent tranche par tranche (alignées sur l'heure de fin).
    const far = await Promise.all(w.remotes.filter((x) => x.online).map((x) => x.call<TokenRate>('GET', '/api/usage/rate?local=1').catch(() => null)))
    for (const f of far) {
      if (!f || f.step !== r.step) continue
      if (f.available !== false) r.available = true
      const shift = Math.round((r.end - f.end) / r.step)
      f.buckets.forEach((v, i) => {
        const j = i - shift
        if (j >= 0 && j < r.buckets.length) r.buckets[j] += v
      })
    }
    json(res, 200, r)
  }],
  // Spend estimate (API-price dollars from the transcripts) matched with the real Claude quota: pace and forecast.
  ['GET', /^\/api\/usage\/spend$/, async (_req, res) => {
    const q = (await quotas()).claude
    const es = spendEntries()
    const first = summarize(es, q)
    const s = summarize(es, q, Date.now(), anchorFor(first.week.end) ?? undefined)
    logCalibration(s, es, q)
    json(res, 200, { ...s, week: { ...s.week, bySession: s.week.bySession.slice(0, 10) } })
  }],
  // Tempo: the modes, what each would use (from the spend ledger, with sources and confidence), and setting one.
  ...(tempo ? ([
    ['GET', /^\/api\/tempo$/, async (_req, res) => json(res, 200, await tempo.view())],
    ['POST', /^\/api\/tempo$/, async (req, res) => {
      const b = await readBody(req)
      if (!isTempoMode(b?.mode)) return json(res, 400, { error: 'tempo_mode_unknown' })
      const repo = typeof b?.repo === 'string' && b.repo ? b.repo : null
      try {
        const v = await tempo.set(b.mode, repo)
        w.bump()
        json(res, 200, v)
      } catch {
        json(res, 409, { error: 'tempo_mode_locked' })
      }
    }],
  ] as [string, RegExp, Handler][]) : []),
  ['GET', /^\/api\/usage\/today$/, async (_req, res, url) => {
    const sessions = new Map(w.snapshot().sessions.map((s) => [s.id, s]))
    const { rows, models } = usageToday((id) => sessions.get(id))
    if (url.searchParams.has('local')) return json(res, 200, { rows, models })
    const far = await Promise.all(w.remotes.filter((r) => r.online).map((r) => r.call<UsageToday>('GET', '/api/usage/today?local=1').catch(() => ({ rows: [] }) as UsageToday)))
    json(res, 200, {
      rows: [...rows, ...far.flatMap((d) => d.rows)].sort((a, b) => b.weight - a.weight),
      models: [...models, ...far.flatMap((d) => d.models ?? [])],
    })
  }],
  // L'optimiseur de coûts : ce qu'il mesure, et l'audit du jour à la demande (publié dans « pour toi »).
  ...(ORCHESTRATOR ? ([
    ['GET', /^\/api\/cost$/, (_req, res) => json(res, 200, { week: cost.week(), internal: ledger.days(7) })],
    ['POST', /^\/api\/cost\/audit$/, async (_req, res) => json(res, 200, await cost.audit())],
    ['POST', /^\/api\/cost\/run$/, async (_req, res) => json(res, 200, await cost.run())],
  ] as [string, RegExp, Handler][]) : []),
  ...tipRoutes(w, json, readBody, () => !!openaiKey()),
  ...hintRoutes(hints, json, readBody),
  // La mémoire vit sur la machine principale seulement (404 ailleurs, comme weevils memory le dit).
  ...(ORCHESTRATOR ? memoryRoutes(memory, json, readBody) : []),
  ...(threadsApp ? threadsRoutes(threadsApp, json, readBody, isLocal) : []),
  ...(moves ? moves.routes(json, readBody, isLocal) : []),
  // weevboss's requests, goals, work trace and knowledge (server/boss-ledger.ts), main machine only.
  ...(w.ledger ? ledgerRoutes(w.ledger, json, readBody, isLocal) : []),
  // The weevil's questions were removed: an old open app only ever hears « nothing » (server/weevil.ts).
  ...weevilRoutes(json),
  // The automation page reads the timers and jobs here too (GET /api/auto/timer:…, job:…).
  ...optimizerRoutes(optimizers, json, readBody, { detail: (id) => w.h24Detail(id), run: (id, at) => w.h24Run(id, at) }),
  // Le flux « pour toi » vit sur la machine principale seulement.
  ...(foryou ? foryouRoutes(foryou, json, readBody) : []),
  // ---- Mes logiciels : détectés sur chaque machine, aperçu vivant, lancés d'un tap (server/softwares.ts).
  ...softwareRoutes(w, json, readBody),
  ['POST', /^\/api\/github\/pin$/, async (req, res) => {
    const body = await readBody(req)
    w.pinRepo(String(body.repo ?? ''), !!body.pinned)
    json(res, 200, { ok: true })
  }],
  // Your factory (server/your-factory.ts): machines, intelligence, projects, in weevils next's side bar. Main machine only.
  ...(ORCHESTRATOR ? factoryRoutes(factoryDeps(), json, readBody) : []),
]

/** The global choice, made in the app (Your factory, or the onboarding's link): this machine's config and Claude Code's
 *  warning (server/ask-follow.ts), then every other machine at once over its link. Main machine only. */
function chooseAgents(ask: boolean) {
  const r = followAsk(ask, { writeConfig, keepSkip: w.modes.anyAuto() })
  if (r.changed) {
    console.log(`[agents] permission prompts ${r.ask ? 'on' : 'off'}, chosen in the app`)
    w.bump()
  }
  if (!r.refused) for (const remote of w.remotes) void remote.followAsk(Date.now(), true)
  return r
}

/** What Your factory reads and changes, all of it weevils' own (server/your-factory.ts). */
function factoryDeps(): FactoryDeps {
  const farFacts = new Map<string, { at: number; v: MachineFacts | null }>()
  return {
    state: () => w.factory,
    change: (fn) => w.setFactory(fn),
    machines: () => w.snapshot().machines,
    away: () => hub.awayNow().map((a) => ({ name: a.name, n: a.n })),
    hereId: MACHINE.id,
    briefs: async () => {
      const here = brief()
      const far = await Promise.all(w.remotes.filter((r) => r.online).map((r) =>
        r.call<{ machines: MachineBrief[] }>('GET', '/api/infra/brief?local=1').then((d) => ({ ...d.machines[0], id: r.snap?.machines[0]?.id ?? r.id })).catch(() => null)))
      return [here, ...far.filter((b): b is MachineBrief => !!b)]
    },
    facts: async (id) => {
      if (id === MACHINE.id) return facts()
      const hit = farFacts.get(id)
      if (hit && Date.now() - hit.at < 3600_000) return hit.v
      const remote = w.remoteById(id)
      const v = remote ? await remote.call<MachineFacts>('GET', '/api/infra/facts').catch(() => null) : null
      farFacts.set(id, { at: Date.now(), v })
      return v
    },
    sessions: () => w.snapshot().sessions,
    stop: (id) => w.key(id, 'esc'),
    quotas: async () => ({ ...(await quotas()), claude: await claudeAccounts.quota() }),
    accounts: () => (accountsOn() ? claudeAccounts.view() : undefined),
    codex: codexReady,
    configFile: CONFIG_FILE,
    writeConfig,
    pin: (repo, pinned) => w.pinRepo(repo, pinned),
    pinned: () => w.pinnedRepos,
    rejoin: () => setup.rejoinLine(),
    power: machinePower,
    startTalk: (machineId, name, kind, provider, text) =>
      w.create({ projectId: '', machineId, tool: w.factory.intelOff.includes('codex') ? 'claude' : preferredTool(), text: `${text.trim()}\n\n${talkContext(name, kind, provider)}`, title: name }),
  }
}

/** Comment les autres machines joignent celle-ci : leurs alias SSH qui pointent vers son IP, son reverse DNS ou son nom. */
async function reachOf(f: MachineFacts, id: string): Promise<Reach[]> {
  const names = new Set([f.ip, f.rdns, f.hostname, id].filter(Boolean).map((x) => x!.toLowerCase()))
  const others: [string, MachineFacts | null][] = [
    ...(id === MACHINE.id ? [] : [[MACHINE.name, await facts()] as [string, MachineFacts]]),
    ...(await Promise.all(
      w.remotes
        .filter((r) => r.online && (r.snap?.machines[0]?.id ?? r.id) !== id)
        .map(async (r) => [r.snap?.machines[0]?.name ?? r.id, await r.call<MachineFacts>('GET', '/api/infra/facts').catch(() => null)] as [string, MachineFacts | null]),
    )),
  ]
  return others.flatMap(([from, o]) => (o?.ssh ?? []).filter((t) => names.has(t.host.toLowerCase()) || names.has(t.alias.toLowerCase())).map((t) => ({ from, alias: t.alias, user: t.user })))
}

const PUBLIC = new Set(['/api/login', '/api/me'])

/** Envoi d'un export (zip ou JSON, jusqu'à 1 Go) : écrit tel quel sur disque, puis importé. */
async function receiveImport(req: http.IncomingMessage, res: http.ServerResponse) {
  const dir = path.join(DATA_DIR, 'uploads')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `export-${Date.now()}`)
  const out = fs.createWriteStream(file)
  let size = 0
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 1 << 30) {
        req.destroy()
        reject(new Error(tr(M).fileTooLarge))
      }
    })
    req.pipe(out)
    out.on('finish', resolve)
    req.on('error', reject)
  })
  try {
    json(res, 200, await w.importFile(file))
  } finally {
    fs.rmSync(file, { force: true })
  }
}

const outbox = new Outbox(path.join(DATA_DIR, 'outbox'), task => executeOutbox(task, routes))
outbox.start()

const server = http.createServer((req, res) => withLang(requestLang(req), async () => {
  const url = new URL(req.url ?? '/', 'http://local')
  try {
    // The connector's own addresses (/mcp…, /.well-known/oauth-…), with their own sign-in.
    if (connector && (await connector.handle(req, res, url))) return
    // A page link: signed in, its keyed files; otherwise the app, which signs in and then opens it.
    const page = req.method === 'GET' || req.method === 'HEAD' ? pageLink(url.pathname) : undefined
    if (page) {
      if (!authed(req) || !pages.get(page.slug)) return serveStatic(req, res, new URL('/', 'http://local'))
      res.writeHead(302, { location: `/api/page/${pages.key(page.slug)}/${page.slug}/`, 'cache-control': 'no-store' })
      return void res.end()
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url)
    // A change asked by a browser comes from the app's own pages only (server/http.ts appWriteAllowed).
    if (!appWriteAllowed(req, PUBLIC_URL)) return json(res, 403, { error: tr(M).signInRequired })
    const keyed = PAGE_KEY_RE.exec(url.pathname)
    if (keyed && (req.method === 'GET' || req.method === 'HEAD')) return pages.serve(req, res, keyed[1], keyed[2], keyed[3])
    // A computer bringing its conversations: its one-time code is its key, not the access code (server/bring.ts).
    if (url.pathname.startsWith('/api/bring') && (url.pathname === '/api/bring.sh' || url.pathname.startsWith('/api/bring/pc/')) && (await bring.pcRoute(req, res, url.pathname))) return
    // Another computer joining from its line: the one-time code is its key (server/join.ts).
    if (ORCHESTRATOR && url.pathname.startsWith('/api/join') && (await joinRoute(req, res, url.pathname, { join, machine: MACHINE.id, lang: installationLang(), ask: askPermissions(), onJoined: machineJoined, onFailed: machineJoinFailed, vault: joinVault }))) return
    const site = SITE_RE.exec(url.pathname)
    if (site && req.method === 'GET') return serveSite(res, site[1], site[2], site[3])
    // Le Raccourci Siri n'a pas de cookie : son jeton personnel n'ouvre que le tour de parole et le son qui va avec.
    const viaShortcut = /^\/api\/voice\/(turn|clip\/)/.test(url.pathname) && shortcutAuthed(req, url)
    if (!PUBLIC.has(url.pathname) && !viaShortcut && !authed(req)) {
      // From this machine without the local token (an old weevils command, or a program that does not read the user's
      // files): said plainly, with what to do.
      const problem = localTokenProblem(req)
      return json(res, 401, { error: problem === 'missing' ? tr(M).localTokenMissing : problem === 'wrong' ? tr(M).localTokenWrong : tr(M).signInRequired, ...(problem ? { code: `local_token_${problem}` } : {}) })
    }
    // An automation's jail calling on loopback: only its CLI profile's routes (server/jail-peer.ts).
    if (!hasDevice(req) && isLocal(req) && jailedPeer(req.socket) && !jailedAllowed(req.method, url.pathname)) return json(res, 403, { error: tr(M).signInRequired })
    if (!door.tapAllowed(req, req.method, url.pathname) || !door.voiceAllowed(req, url.pathname, viaShortcut)) return json(res, 403, { error: tr(M).bossUserOnly })
    if (req.method === 'GET' && url.pathname === '/api/outbox/capabilities') return json(res, 200, { enabled: true, version: 1 })
    const receipt = /^\/api\/outbox\/([a-zA-Z0-9_-]{16,120})$/.exec(url.pathname)
    if (req.method === 'GET' && receipt) {
      const found = outbox.get(receipt[1])
      return json(res, found ? 200 : 404, found ?? { error: tr(OM).missing })
    }
    if (req.method === 'POST' && outboxRoute(url.pathname) && req.headers['idempotency-key']) {
      const key = req.headers['idempotency-key']
      if (typeof key !== 'string') throw new OutboxError(400, tr(OM).invalid)
      const body = await readBody(req, /\/attach$/.test(url.pathname) ? 48 << 20 : 1 << 20)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OutboxError(400, tr(OM).invalid)
      if (!/\/act$/.test(url.pathname) && !String(body.text ?? '').trim() && !(Array.isArray(body.files) && body.files.length)) throw new OutboxError(400, tr(OM).invalid)
      door.guard(req, url.pathname, body) // checked here, on the request itself: the replay is this machine's
      const from = trustedFrom(req, body, sourceAuthor)
      const source = trustedSource(req,body,sourceAuthor)
      const origin = requestOrigin(req, body, from)
      delete body.from
      delete body.sourceThread // Persist only source identity validated on the original request.
      delete body.origin
      delete body.forUser
      if (from) body.from = from
      if (source) body.sourceThread = source
      if (origin) body.origin = origin
      const session = /^\/api\/sessions\/([^/]+)\//.exec(url.pathname)
      const id = session ? decodeURIComponent(session[1]) : url.pathname.startsWith('/api/main') ? w.bossConversation() ?? undefined : undefined
      const lane = id ?? (url.pathname.startsWith('/api/main') ? 'main' : url.pathname)
      return json(res, 202, outbox.accept(key, { url: url.pathname + url.search, body, lane, locale: lang() }, id))
    }
    for (const [method, re, handler] of routes) {
      const m = re.exec(url.pathname)
      if (m && req.method === method) return await handler(req, res, url, m.slice(1))
    }
    json(res, 404, { error: tr(M).unknownRoute })
  } catch (e) {
    json(res, e instanceof OutboxError ? e.status : 400, { error: (e as Error).message })
  }
}))

// Live voice mode (server/live.ts): the phone's websocket, proxied to Gemini Live. The key stays here.
const live = liveUpgrade({
  key: geminiKey,
  enabled: () => ORCHESTRATOR,
  sendMain: (text) => w.sendMain(text, undefined, 'live'),
  waitMainReply: (since, ms) => w.waitMainReply(since, ms),
  recent: () => w.recentMain(8),
  user,
})
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://local')
  // Live voice speaks as the user: a signed-in browser only, never a script on this machine (2026-11-14: a test played
  // recorded questions into it). A test copy opens it with WEEVILS_ALLOW_LOCAL_VOICE=1.
  if (url.pathname !== '/api/live' || !door.liveAllowed(req, authed(req)) || !sameOrigin(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  live(req, socket, head, requestLang(req))
})

server.listen(PORT, HOST, () => console.log(`weevilsd → http://${HOST}:${PORT}`))
// A Mac goes to sleep on its own: kept awake while one of its agents works or waits for an answer and the Mac is
// plugged in, then left to sleep (WEEVILS_KEEP_AWAKE=0: never kept awake).
if (process.platform === 'darwin') {
  const awake = new Awake()
  const look = () => awake.update(w.snapshot().sessions.some((s) => !s.archived && (s.machineId ?? MACHINE.id) === MACHINE.id && (s.status === 'working' || s.status === 'needs_user')))
  setInterval(look, 30_000).unref()
  look()
}


// ---------------------------------------------------------------- « How weevils works » (server/pages.ts, docs/LINKS.md)
// An explainer, not a dashboard: the only live part is which pieces main touched in the last day, read from the
// git log of weevils' own checkout. Every install gets its own page at /p/report/how-weevils-works.
const SELF_DIR = path.resolve(import.meta.dirname, '..')
let touched: { at: number; changed: Record<string, number> } = { at: 0, changed: {} }
pages.live = {
  state: () => new Promise((resolve) => {
    if (Date.now() - touched.at < 60_000) return resolve({ changed: touched.changed })
    execFile('git', ['-C', SELF_DIR, 'log', '--since=1 day ago', '--no-merges', '--name-only', '--format=%x1e%ct'], { timeout: 5000, maxBuffer: 4 << 20 }, (err, out) => {
      const log = err ? [] : String(out).split('\x1e').filter((c) => c.trim()).map((c) => {
        const [ct, ...files] = c.split('\n').map((l) => l.trim()).filter(Boolean)
        return { at: Number(ct) * 1000, files }
      })
      touched = { at: Date.now(), changed: changedPieces(log) }
      resolve({ changed: touched.changed })
    })
  }),
}
try { pages.publishMachine() } catch (e) { console.error('[pages] machine', e) }

// Hooks Claude Code : port séparé, local uniquement. Une page web ouverte sur cette machine (Origin étrangère, DNS
// rebinding) ne peut pas y forger d'événements, ni un autre compte de la machine (server/jail-peer.ts sameUserPeer).
http
  .createServer(async (req, res) => {
    if (!browserSafe(req) || !sameUserPeer(req.socket)) return void res.writeHead(403).end()
    try {
      const body = await readBody(req, 256 << 10)
      w.hook(body, req.headers['x-pid'] as string | undefined)
      console.log(`[hook] ${body?.hook_event_name ?? '?'} ${String(body?.session_id ?? '').slice(0, 8)}`)
      res.writeHead(200).end('ok')
    } catch {
      res.writeHead(400).end()
    }
  })
  .listen(HOOK_PORT, '127.0.0.1', () => console.log(`hooks → http://127.0.0.1:${HOOK_PORT}`))

process.on('uncaughtException', (e) => console.error('[weevilsd]', e))
process.on('unhandledRejection', (e) => console.error('[weevilsd]', e))
