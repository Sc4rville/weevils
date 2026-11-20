import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, expect, it, vi, describe } from 'vitest'
import type { SetupDeps, SetupState } from './setup.ts'

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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-welcome-'))
process.env.WEEVILS_CONFIG = path.join(dir, 'env')
process.env.WEEVILS_LANG = 'en'
const { Setup, greeting, firstRunBrief, joinHost, looksLikeLoginCode } = await import('./setup.ts')
const { withLang } = await import('./i18n.ts')
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
    pkg: 'apt', sudo: 'no', tools: {} as SetupState['tools'], projects: 0, projectNames: [], connector: false,
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
  it('ready: who it is, what it already sees, then what to ask; no button, nothing about how it works', () => {
    auth.ready = true
    const text = greeting(state({ projects: 3, projectNames: ['weevils', 'notes', 'site'], others: ['laptop'] }), both)
    expect(text).toBe('Hi, I’m weevboss. I can already see your 3 projects (weevils, notes and site), and laptop is plugged in too. Tell me what you want done: an idea, a fix, a question about your code.')
    const fr = withLang('fr', () => greeting(state({ projects: 12, projectNames: ['a', 'b', 'c', 'd'] }), both))
    expect(fr).toBe('Salut, moi c’est weevboss. Je vois déjà tes 12 projets (a, b, c, d…). Dis-moi ce que tu veux faire : une idée, un correctif, une question sur ton code.')
    expect(greeting(state(), both)).toBe('Hi, I’m weevboss. Tell me what you want done: an idea, a fix, a question about your code.')
    for (const t of [text, fr]) expect(t).not.toMatch(/\[\[setup:|relay|thread|weevbook|session|fil\b/i)
  })

  it('no subscription signed in: Claude’s link in the hello itself, the code pasted here', () => {
    const text = greeting(state({ projects: 1, projectNames: ['notes'] }), both, 'https://claude.ai/oauth/authorize?code=abc')
    expect(text).toBe('Hi, I’m weevboss. I can already see your project (notes). To think, I use your own Claude subscription. Open [Claude’s sign-in page](https://claude.ai/oauth/authorize?code=abc), accept, then paste the code it shows here.')
    expect(greeting(state({ claude: { installed: true, logged: false } }), both)).toContain('the sign-in link comes right below')
    expect(greeting(state({ claude: { installed: false, logged: false } }), both)).toContain('I’m installing Claude Code on box first')
    auth.tool = 'codex'
    expect(greeting(state(), both)).toContain('your ChatGPT subscription, through Codex')
    auth.tool = 'claude'
    expect(greeting(state(), { claude: false, codex: true })).toContain('through Codex')
    expect(withLang('fr', () => greeting(state(), both, 'https://claude.ai/x'))).toContain('colle ici le code qu’elle affiche')
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
    expect(texts()).toEqual(['Hi, I’m weevboss. I can already see your project (notes). To think, I use your own Claude subscription. Open [Claude’s sign-in page](https://claude.ai/oauth/authorize?code=abc), accept, then paste the code it shows here.'])
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
    expect(texts().at(-1)).toMatch(/^Claude Code is signed in/)
    for (const t of texts()) expect(t).not.toContain('[[setup:')
    const ctx = s.contextFor()
    expect(ctx).not.toContain(code)
    expect(ctx).toContain('(a sign-in code, not shown)')
    expect(ctx).toContain('onboarding is this conversation')
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
    expect(texts().at(-1)).toMatch(/^On your other computer, open a terminal and paste this line:/)
    expect(join.open(line![2])?.target).toBe('user@weevils.example.com')
    expect(s.contextFor()).not.toContain(line![2])
    s.joined('laptop')
    expect(texts().at(-1)).toBe('laptop is plugging in: weevils is installing there, a few minutes.')
    machines.push({ id: 'laptop', name: 'laptop', online: true })
    await (s as unknown as { watch: () => Promise<void> }).watch()
    expect(texts().at(-1)).toBe('laptop is plugged in: I can run agents there now.')
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
