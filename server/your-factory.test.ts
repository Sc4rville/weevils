// Your factory (server/your-factory.ts): what it reads is weevils' own, and its switches really switch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../shared/api.ts'
import type { QuotaInfo } from '../shared/infra.ts'
import { applyKeys, configValue, factoryRoutes, factoryView, health, hostName, keysOff, leftOf, machineKind, onDemandOrder, panelUrl, readMeter, resetMeters, type FactoryDeps, type FactoryState } from './your-factory.ts'

const q = (windows: QuotaInfo['windows'], plan?: string): QuotaInfo => ({ ok: true, windows, source: 'test', at: 1, ...(plan ? { plan } : {}) })
const sess = (id: string, status: Session['status'], machineId?: string) => ({ id, status, machineId, archived: false }) as unknown as Session

function deps(over: Partial<FactoryDeps> = {}): FactoryDeps & { st: FactoryState } {
  const st: FactoryState = { names: {}, machinesOff: [], intelOff: [], hidden: [], talks: {} }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yf-'))
  const d = {
    st,
    state: () => st,
    change: (fn: (f: FactoryState) => void) => fn(st),
    machines: () => [{ id: 'box', name: 'box', online: true }, { id: 'laptop', name: 'laptop', online: true }],
    hereId: 'box',
    briefs: async () => [{ id: 'box', name: 'box', online: true, cpu: 20, mem: 40, disk: 88, level: 'ok' as const, weevboss: true }],
    facts: async (id: string) => (id === 'box' ? { virt: 'kvm', provider: 'Hostinger', publicIp: true } : { laptop: true, publicIp: false }) as never,
    sessions: () => [sess('a', 'working'), sess('b', 'working', 'laptop'), sess('c', 'idle')],
    stop: vi.fn(async () => {}),
    quotas: async () => ({ claude: q([{ kind: 'session', percent: 30, resetsAt: 5 }, { kind: 'week', percent: 62, resetsAt: 9 }], 'max'), codex: q([]) }),
    accounts: () => undefined,
    codex: () => true,
    configFile: path.join(dir, 'env'),
    env: {} as NodeJS.ProcessEnv,
    pin: vi.fn(),
    pinned: () => [] as string[],
    startTalk: vi.fn(async () => ({ id: 'talk-1' })),
    fetch: (async () => { throw new Error('no network in tests') }) as unknown as typeof fetch,
    ...over,
  }
  return d
}

function route(d: FactoryDeps, method: string, url: string, body: unknown = {}) {
  const r = factoryRoutes(d, (_res, status, out) => void (result = { status, out }), async () => body)
  let result: { status: number; out: any } = { status: 0, out: null }
  const hit = r.find(([m, re]) => m === method && re.test(url))!
  return Promise.resolve(hit[2]({} as never, {} as never, new URL(`http://x${url}`), [])).then(() => result)
}

describe('what the factory reads', () => {
  it('tells a server at a host from a computer of yours, never guessing', () => {
    expect(machineKind({ virt: 'kvm', publicIp: true })).toBe('server')
    expect(machineKind({ laptop: true })).toBe('pc')
    expect(machineKind({ virt: 'wsl' })).toBe('pc')
    expect(machineKind(null)).toBeNull()
    expect(panelUrl('Hostinger International')).toMatch(/^https:\/\/hpanel\.hostinger\.com/)
    expect(panelUrl('Some Unknown Host')).toBeUndefined()
    expect(hostName('Hostinger Operations UAB')).toBe('Hostinger')
    expect(hostName('DigitalOcean, LLC')).toBe('DigitalOcean')
  })
  it('folds processor, memory and disk into one health figure', () => {
    expect(health({ cpu: 10, mem: 30, disk: 88 })).toEqual({ load: 88, level: 'warn' })
    expect(health({ cpu: 95, mem: 30 })).toEqual({ load: 95, level: 'crit' })
    expect(health({ cpu: 10, mem: 20, disk: 40 }).level).toBe('ok')
  })
  it('says what is left of the fullest window', () => {
    expect(leftOf(q([{ kind: 'session', percent: 30, resetsAt: 5 }, { kind: 'week', percent: 62, resetsAt: 9 }]))).toEqual({ left: 38, resetsAt: 9 })
    expect(leftOf(q([]))).toBeNull()
  })
  it('lists the machines with their health, kind and host, and the intelligence with what is left', async () => {
    const d = deps()
    fs.writeFileSync(d.configFile, 'OPENAI_API_KEY=sk-test\n')
    const v = await factoryView(d)
    expect(v.machines[0]).toMatchObject({ id: 'box', kind: 'server', here: true, load: 88, level: 'warn', provider: 'Hostinger' })
    expect(v.machines[0].panel).toMatch(/hostinger/)
    expect(v.machines[1]).toMatchObject({ id: 'laptop', kind: 'pc', load: null })
    expect(v.machines[1].panel).toBeUndefined()
    expect(v.intelligence.map((x) => x.id)).toEqual(['claude', 'codex', 'key:OPENAI_API_KEY'])
    expect(v.intelligence[0]).toMatchObject({ left: 38, toggle: false, plan: 'max' })
    expect(v.intelligence[1]).toMatchObject({ left: null, toggle: true })
  })
})

describe('what the factory switches', () => {
  it('turns a machine off, stopping only what works on it, and back on', async () => {
    const d = deps()
    const r = await route(d, 'POST', '/api/factory/machine', { id: 'laptop', off: true })
    expect(r.out).toEqual({ ok: true, stopped: 1 })
    expect(d.stop).toHaveBeenCalledWith('b')
    expect(d.st.machinesOff).toEqual(['laptop'])
    await route(d, 'POST', '/api/factory/machine', { id: 'laptop', off: false })
    expect(d.st.machinesOff).toEqual([])
  })
  it('renames a machine in place, and an empty name gives its own back', async () => {
    const d = deps()
    await route(d, 'POST', '/api/factory/machine', { id: 'box', name: '  My   server ' })
    expect(d.st.names).toEqual({ box: 'My server' })
    await route(d, 'POST', '/api/factory/machine', { id: 'box', name: '' })
    expect(d.st.names).toEqual({})
    expect((await route(d, 'POST', '/api/factory/machine', { id: 'nope', name: 'x' })).status).toBe(400)
  })
  it('takes a key out of the environment without deleting it, and puts it back', async () => {
    const d = deps()
    fs.writeFileSync(d.configFile, 'OPENAI_API_KEY=sk-test\n')
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-test' }
    applyKeys(['key:OPENAI_API_KEY'], d.configFile, env)
    expect(env.OPENAI_API_KEY).toBeUndefined()
    applyKeys([], d.configFile, env)
    expect(env.OPENAI_API_KEY).toBe('sk-test')
    expect(fs.readFileSync(d.configFile, 'utf8')).toContain('OPENAI_API_KEY=sk-test')
  })
  it('never switches Claude off (it carries weevboss), Codex yes', async () => {
    const d = deps()
    expect((await route(d, 'POST', '/api/factory/intelligence', { id: 'claude', off: true })).status).toBe(400)
    await route(d, 'POST', '/api/factory/intelligence', { id: 'codex', off: true })
    expect(d.st.intelOff).toEqual(['codex'])
  })
  it('pins a project into the side bar with the app’s own pin, and takes it out', async () => {
    const pinned: string[] = []
    const d = deps({ pinned: () => pinned, pin: vi.fn((r: string, on: boolean) => void (on ? pinned.push(r) : pinned.splice(pinned.indexOf(r), 1))) })
    await route(d, 'POST', '/api/factory/project', { id: 'shop', repos: ['shop-app', 'shop-api'], shown: true })
    expect(pinned).toEqual(['shop-app'])
    expect(d.st.hidden).toEqual([])
    await route(d, 'POST', '/api/factory/project', { id: 'shop', repos: ['shop-app', 'shop-api'], shown: false })
    expect(pinned).toEqual([])
    expect(d.st.hidden).toEqual(['shop'])
  })
  it('pins a drawer of the side bar or takes it out, and refuses anything else', async () => {
    const d = deps()
    await route(d, 'POST', '/api/factory/drawer', { id: 'pages', shown: false })
    await route(d, 'POST', '/api/factory/drawer', { id: 'autonomous', shown: true })
    expect(d.st.drawers).toEqual({ pages: false, autonomous: true })
    // No requests band in the side bar any more (2026-11-27): nothing to pin or take out.
    expect((await route(d, 'POST', '/api/factory/drawer', { id: 'requests', shown: false })).status).toBe(400)
    expect(d.st.drawers).toEqual({ pages: false, autonomous: true })
    expect((await route(d, 'POST', '/api/factory/drawer', { id: 'misc', shown: true })).status).toBe(400)
    // settings is always in the side bar: it cannot be taken out.
    expect((await route(d, 'POST', '/api/factory/drawer', { id: 'settings', shown: false })).status).toBe(400)
    expect((await route(d, 'POST', '/api/factory/drawer', { id: 'weevils', shown: false })).status).toBe(400)
    expect((await route(d, 'POST', '/api/factory/drawer', { id: 'pages' })).status).toBe(400)
  })
  it('pins a conversation started with no repo in the side bar, its own band, or takes it out', async () => {
    const d = deps()
    await route(d, 'POST', '/api/factory/session', { id: '0c3dea6a-eca6-4dac-aab1-870fdbb63208', pinned: true })
    expect(d.st.pinnedSessions).toEqual(['0c3dea6a-eca6-4dac-aab1-870fdbb63208'])
    await route(d, 'POST', '/api/factory/session', { id: '0c3dea6a-eca6-4dac-aab1-870fdbb63208', pinned: false })
    expect(d.st.pinnedSessions).toEqual([])
    expect(d.st.metSessions).toEqual(['0c3dea6a-eca6-4dac-aab1-870fdbb63208'])
    expect((await route(d, 'POST', '/api/factory/session', { id: '../x', pinned: true })).status).toBe(400)
  })
  it('shares tests and builds between two machines or more, on until turned off', async () => {
    const d = deps({ away: () => [{ name: 'laptop', n: 2 }] })
    expect((await factoryView(d)).share).toEqual({ on: true, away: [{ name: 'laptop', n: 2 }] })
    expect((await route(d, 'POST', '/api/factory/share', { on: false })).status).toBe(200)
    expect(d.st.shareJobs).toBe(false)
    expect((await factoryView(d)).share?.on).toBe(false)
    await route(d, 'POST', '/api/factory/share', { on: true })
    expect('shareJobs' in d.st).toBe(false)
    expect((await route(d, 'POST', '/api/factory/share', { on: 'yes' })).status).toBe(400)
    expect((await factoryView(deps({ machines: () => [{ id: 'box', name: 'box', online: true }] }))).share).toBeUndefined()
  })

  it('starts a machine’s own conversation once, then finds it again', async () => {
    let sessions = [sess('a', 'working')]
    const d = deps({ sessions: () => sessions })
    const r = await route(d, 'POST', '/api/factory/talk', { machine: 'laptop', text: 'how is the disk?' })
    expect(r.out).toEqual({ id: 'talk-1' })
    expect(d.startTalk).toHaveBeenCalledWith('laptop', 'laptop', 'pc', undefined, 'how is the disk?')
    expect(d.st.talks).toEqual({ laptop: 'talk-1' })
    sessions = [...sessions, sess('talk-1', 'idle')]
    await route(d, 'POST', '/api/factory/talk', { machine: 'laptop', text: 'again' })
    expect(d.startTalk).toHaveBeenCalledTimes(1)
  })
  it('a machine that does not answer: why and since when on its card, and a fresh line that brings it back', async () => {
    const away = { why: 'link' as const, since: 1_795_446_182_000 }
    const rejoin = vi.fn(async () => 'curl -fsSL https://w.example/api/join.sh | bash -s CODE')
    const d = deps({ machines: () => [{ id: 'box', name: 'box', online: true }, { id: 'laptop', name: 'laptop', online: false, away }], rejoin })
    const v = await factoryView(d)
    expect(v.machines.find((m) => m.id === 'laptop')).toMatchObject({ online: false, away })
    expect(v.machines.find((m) => m.id === 'box')!.away).toBeUndefined()
    expect((await route(d, 'POST', '/api/factory/rejoin', { machine: 'laptop' })).out).toEqual({ line: 'curl -fsSL https://w.example/api/join.sh | bash -s CODE' })
    // Not for this machine itself, nor one it does not know; and said plainly when no line can be made here.
    expect((await route(d, 'POST', '/api/factory/rejoin', { machine: 'box' })).status).toBe(400)
    expect((await route(d, 'POST', '/api/factory/rejoin', { machine: 'nope' })).status).toBe(400)
    expect(rejoin).toHaveBeenCalledTimes(1)
    const none = await route(deps({ rejoin: async () => null }), 'POST', '/api/factory/rejoin', { machine: 'laptop' })
    expect(none.status).toBe(409)
    expect(none.out.error).toMatch(/SSH/)
  })
  it('the switch drives another machine’s link, never this one’s', async () => {
    const power = vi.fn()
    const d = deps({ power })
    await route(d, 'POST', '/api/factory/machine', { id: 'laptop', off: true })
    await route(d, 'POST', '/api/factory/machine', { id: 'laptop', off: false })
    await route(d, 'POST', '/api/factory/machine', { id: 'box', off: true })
    await route(d, 'POST', '/api/factory/machine', { id: 'laptop', name: 'Laptop' })
    expect(power.mock.calls).toEqual([['laptop', false], ['laptop', true]])
  })
})

/** setup.ts writeConfig in small: replaces or adds a line of the test's config file. */
const writer = (file: string) => (changes: Record<string, string>) => {
  let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
  for (const [k, v] of Object.entries(changes)) lines = [...lines.filter((l) => !l.startsWith(`${k}=`)), `${k}=${v}`]
  fs.writeFileSync(file, lines.join('\n') + '\n')
}
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** A provider's API in small: RunPod's GraphQL and Vast.ai's REST, keyed by the bearer they are given. */
function providers(over: { runpod?: Response; vastUser?: Response; vastList?: Response } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('runpod')) return over.runpod ?? answer(200, { data: { myself: { clientBalance: 6.7021, currentSpendPerHr: 0.44 } } })
    if (u.endsWith('/users/current/')) return over.vastUser ?? answer(200, { credit: 12.5 })
    return over.vastList ?? answer(200, { instances: [{ actual_status: 'running', dph_total: 0.3 }, { actual_status: 'exited', dph_total: 0.9 }, { actual_status: 'running', dph_total: 0.25 }] })
  }) as unknown as typeof fetch
}

describe('on demand', () => {
  it('orders the providers switched on: the setting first, then the others, never one switched off', () => {
    expect(onDemandOrder(undefined, ['runpod', 'vast'])).toEqual(['runpod', 'vast'])
    expect(onDemandOrder('vast,runpod', ['runpod', 'vast'])).toEqual(['vast', 'runpod'])
    expect(onDemandOrder('vast', ['runpod'])).toEqual(['runpod'])
    expect(onDemandOrder('none', [])).toEqual([])
    expect(onDemandOrder('lambda, vast', ['runpod', 'vast'])).toEqual(['vast', 'runpod'])
  })
  it('reads each provider’s own meter, and says when a key is refused', async () => {
    expect(await readMeter('runpod', 'k', providers())).toEqual({ credit: 6.7, perHour: 0.44 })
    expect(await readMeter('vast', 'k', providers())).toEqual({ credit: 12.5, perHour: 0.55 })
    expect(await readMeter('runpod', 'k', providers({ runpod: answer(401, {}) }))).toEqual({ refused: true, credit: null, perHour: null })
    expect(await readMeter('vast', 'k', providers({ vastUser: answer(403, {}) }))).toEqual({ refused: true, credit: null, perHour: null })
    // A figure the provider does not give stays unknown, never zero.
    expect(await readMeter('vast', 'k', providers({ vastList: answer(500, {}) }))).toEqual({ credit: 12.5, perHour: null })
    expect(await readMeter('runpod', 'k', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toEqual({ credit: null, perHour: null })
  })
  it('sends the key only to its own provider, as a bearer', async () => {
    const f = providers()
    await readMeter('runpod', 'rp-secret', f)
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toBe('https://api.runpod.io/graphql')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer rp-secret' })
  })
  it('lists every provider, those switched on first with their figures, and writes the order agents read', async () => {
    resetMeters()
    const d = deps({ fetch: providers() })
    d.writeConfig = writer(d.configFile)
    fs.writeFileSync(d.configFile, 'RUNPOD_API_KEY=rp-test\n')
    const v = await factoryView(d)
    expect(v.onDemand).toEqual([
      expect.objectContaining({ id: 'runpod', connected: true, rank: 1, credit: 6.7, perHour: 0.44 }),
      expect.objectContaining({ id: 'vast', connected: false, rank: null, credit: null }),
    ])
    expect(configValue(d.configFile, 'WEEVILS_ON_DEMAND')).toBe('runpod')
    expect(JSON.stringify(v)).not.toContain('rp-test')
  })
  it('switches a provider off (out of the order and the environment, key kept), back on, and puts one first', async () => {
    resetMeters()
    const env: NodeJS.ProcessEnv = { RUNPOD_API_KEY: 'rp-test', VAST_API_KEY: 'va-test' }
    const d = deps({ fetch: providers(), env })
    d.writeConfig = writer(d.configFile)
    fs.writeFileSync(d.configFile, 'RUNPOD_API_KEY=rp-test\nVAST_API_KEY=va-test\n')
    await factoryView(d)
    expect(configValue(d.configFile, 'WEEVILS_ON_DEMAND')).toBe('runpod,vast')
    await route(d, 'POST', '/api/factory/on-demand', { id: 'vast', first: true })
    expect(configValue(d.configFile, 'WEEVILS_ON_DEMAND')).toBe('vast,runpod')
    await route(d, 'POST', '/api/factory/on-demand', { id: 'vast', off: true })
    expect(d.st.onDemandOff).toEqual(['vast'])
    expect(env.VAST_API_KEY).toBeUndefined()
    expect(configValue(d.configFile, 'WEEVILS_ON_DEMAND')).toBe('runpod')
    expect(configValue(d.configFile, 'VAST_API_KEY')).toBe('va-test')
    const v = await factoryView(d)
    expect(v.onDemand?.map((x) => [x.id, x.rank])).toEqual([['runpod', 1], ['vast', null]])
    expect(v.onDemand?.[1]).toMatchObject({ connected: true, credit: null })
    await route(d, 'POST', '/api/factory/on-demand', { id: 'runpod', off: true })
    expect(configValue(d.configFile, 'WEEVILS_ON_DEMAND')).toBe('none')
    await route(d, 'POST', '/api/factory/on-demand', { id: 'vast', off: false })
    expect(env.VAST_API_KEY).toBe('va-test')
    expect(configValue(d.configFile, 'WEEVILS_ON_DEMAND')).toBe('vast')
    expect((await route(d, 'POST', '/api/factory/on-demand', { id: 'lambda', off: true })).status).toBe(400)
    expect(keysOff(d.st)).toEqual(['key:RUNPOD_API_KEY'])
  })
})
