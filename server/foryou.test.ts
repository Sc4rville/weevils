// The « for you » stream: the store (cap, age, one item per session, what never enters), mail privacy, posts and their
// buttons, replies, media, live alerts and proposals, seen / dismissed across a restart, the order (arrange) and who
// may post. No server, no model: the host (Weevils) is a plain object.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, Optimizer, Session, Snapshot } from '../shared/api.ts'
import type { ForYouItem, ForYouKind } from '../shared/foryou.ts'
import type { UsageInfo } from '../shared/infra.ts'
import {
  DEEP_GAP, FRESH_MEDIA_MS, ForYou, KEEP_MS, MAX_CARDS, MAX_FEED, MAX_ITEMS, MAX_MEDIA, MEDIA_JOIN_MS, OFFLINE_AFTER_MS, PROPOSALS_SLOT, REFRESH_MS, TEXT_MAX,
  arrange, firstLine, foryouRoutes, lastWords, score, type ForYouDeps, type MachineState,
} from './foryou.ts'
import M from './i18n/foryou.ts'
import TM from './i18n/tips.ts'

// Only for the last block (the hooks in core.ts, with a real Weevils): tmux and the voice are simulated, as in
// lifecycle.test.ts. The stream itself imports none of them.
const mux = vi.hoisted(() => ({
  sendText: vi.fn(async (_name: string, _text: string) => {}),
  sendKey: vi.fn(async (_name: string, _key: string) => {}),
  capture: vi.fn(async (_name: string) => ''),
  spawnWv: vi.fn(async (..._args: unknown[]) => {}),
  killWv: vi.fn(async (_name: string) => {}),
  listWv: vi.fn(async () => [] as unknown[]),
  setOpt: vi.fn(async (..._args: unknown[]) => {}),
}))
vi.mock('./mux.ts', async (orig) => ({ ...(await orig<typeof import('./mux.ts')>()), ...mux }))
vi.mock('./voicepipe.ts', () => ({ keepWarm() {}, warmCues() {} }))
vi.mock('./fast.ts', () => ({ setCartesiaVoice() {} }))
vi.mock('./titles.ts', async (orig) => ({ ...(await orig<typeof import('./titles.ts')>()), llmTitles: async () => [] }))

const T0 = new Date('2026-11-10T09:00:00Z').getTime()
const MIN = 60_000
const HOUR = 3600_000

const session = (over: Partial<Session> = {}): Session =>
  ({ id: 's1', projectId: 'mygame', repo: 'mygame', machineId: 'test', tool: 'claude', title: 'Jump physics', status: 'idle', cwd: '/home/u/projects/mygame', lastActivityAt: T0, origin: 'weevils', controllable: true, live: true, hasScreen: true, messageCount: 4, lastMessage: 'short tail', ...over }) as Session
const optimizer = (over: Partial<Optimizer> = {}): Optimizer => ({ id: 'o1', title: 'Harden the tests', why: 'you want to ship mygame', repo: 'mygame', kind: 'tests', heavy: false, state: 'proposed', createdAt: T0, ...over })
const says = (text: string, role: Message['role'] = 'assistant'): Message => ({ id: `m${Math.random()}`, role, text, at: T0 })

let dir: string
let now: number
let snap: Snapshot
let threads: Record<string, Message[]>
let transcripts: Map<string, { firstPrompt?: string; headless?: boolean; originator?: string }>
/** Weevils, as the stream sees it. */
const newHost = () => ({
  snapshot: () => snap,
  bump: vi.fn(() => {}),
  detailAny: async (id: string) => (threads[id] ? { session: session({ id }), messages: threads[id] } : undefined),
  send: vi.fn(async (id: string, _text: string, _from?: string) => ({ id })),
  sendMain: vi.fn(async (_text: string, _brief?: string) => ({ id: 'boss' })),
  resume: vi.fn(async (id: string) => ({ id })),
  close: vi.fn(async (_id: string): Promise<unknown> => ({ ok: true })),
  orchestratorId: 'boss' as string | null,
  store: { get: (id: string) => transcripts.get(id) },
})
let host: ReturnType<typeof newHost>
let later: (() => void)[]
/** A shelf that knows the files it is told about (the real one is tested in foryou-media.test.ts). */
let shelf: NonNullable<ForYouDeps['shelf']> & { known: Set<string>; served: string[] }

const make = (deps: ForYouDeps = {}) =>
  new ForYou(host, { file: path.join(dir, 'foryou.json'), now: () => now, dataDir: '/home/u/.local/share/weevils', machineId: 'test', shelf, later: (fn) => void later.push(fn), ...deps })
const flush = () => new Promise((r) => setTimeout(r, 0))
const ids = (fy: ForYou) => fy.feed().items.map((i) => i.id)
const find = (fy: ForYou, id: string) => fy.feed().items.find((i) => i.id === id)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foryou-'))
  now = T0
  later = []
  threads = {}
  transcripts = new Map()
  snap = { machines: [{ id: 'test', name: 'vps', online: true }], projects: [], sessions: [], optimizers: [], conversationCounts: { pending: 0 } } as unknown as Snapshot
  host = newHost()
  const entry = (p: string) => ({ id: `f${Buffer.from(p).toString('hex').slice(-12)}`, path: p, type: /\.mp4$/.test(p) ? ('video' as const) : ('image' as const), bytes: 10, mtime: T0, name: path.basename(p), at: T0 })
  const known = new Set<string>()
  const byId = new Map<string, ReturnType<typeof entry>>()
  shelf = {
    known,
    served: [],
    add(p, cwd) {
      const abs = path.resolve(cwd ?? '/', p)
      if (!known.has(abs)) throw new Error('not a file weevils can show')
      const e = entry(abs)
      byId.set(e.id, e)
      return e
    },
    fromText(text, cwd, max = 4) {
      return [...text.matchAll(/\S+\.(?:png|mp4)/g)].map((m) => path.resolve(cwd ?? '/', m[0])).filter((p) => known.has(p)).slice(0, max).map((p) => this.add(p))
    },
    get: (id) => byId.get(id) ?? null,
    view: (e) => ({ id: e.id, type: e.type, url: `/api/foryou/media/${e.id}`, name: e.name, bytes: e.bytes }),
    serve(_req, _res, id) {
      this.served.push(id)
    },
  }
})

// ---------------------------------------------------------------- the store

describe('the store', () => {
  it('writes foryou.json for the user only, through a temporary file', () => {
    const fy = make()
    fy.post('hello')
    expect(fs.statSync(fy.file).mode & 0o777).toBe(0o600)
    expect(fs.existsSync(`${fy.file}.tmp`)).toBe(false)
    expect(JSON.parse(fs.readFileSync(fy.file, 'utf8')).items).toHaveLength(1)
  })

  it('keeps at most 400 items, the newest, and nothing older than 14 days', () => {
    const fy = make()
    for (let i = 0; i < MAX_ITEMS + 5; i++) {
      now = T0 + i * 1000
      fy.post(`post ${i}`)
    }
    const kept = JSON.parse(fs.readFileSync(fy.file, 'utf8')).items as { text: string }[]
    expect(kept).toHaveLength(MAX_ITEMS)
    expect(kept.some((i) => i.text === 'post 0')).toBe(false)
    expect(kept.some((i) => i.text === `post ${MAX_ITEMS + 4}`)).toBe(true)
    // The app gets 60 of them at most.
    expect(fy.feed().items).toHaveLength(MAX_FEED)
    now = T0 + KEEP_MS + HOUR
    fy.post('the only fresh one')
    expect((JSON.parse(fs.readFileSync(fy.file, 'utf8')).items as { text: string }[]).map((i) => i.text)).toEqual(['the only fresh one'])
  })

  it('starts empty on a missing or broken file', () => {
    fs.writeFileSync(path.join(dir, 'foryou.json'), '{ not json')
    const fy = make()
    expect(fy.feed()).toMatchObject({ rev: 0, items: [], pulse: { working: 0, waiting: 0, delivered: 0, auto: 0 } })
  })
})

// ---------------------------------------------------------------- sessions

describe('session results', () => {
  it('one item per session: the last words of the turn, replaced by the next turn and unseen again', async () => {
    const fy = make()
    const s = session()
    snap.sessions = [s]
    threads.s1 = [says('do it', 'user'), says('The   jump\nnow feels right.')]
    fy.sessionTurn(s, 'result')
    await flush()
    expect(fy.feed().items).toEqual([
      { id: 's:s1', kind: 'session', tone: 'result', at: T0, who: 'session', projectId: 'mygame', sessionId: 's1', tool: 'claude', title: 'Jump physics', text: 'The jump now feels right.', reply: 'session', open: { page: 'session', id: 's1' } },
    ])
    fy.seen(['s:s1'])
    expect(find(fy, 's:s1')?.seen).toBe(true)
    // Same words again (a turn that said nothing new): nothing moves.
    fy.sessionTurn(s, 'result')
    await flush()
    expect(find(fy, 's:s1')?.seen).toBe(true)
    now = T0 + 10 * MIN
    threads.s1.push(says('more', 'user'), says('Double jump added.'))
    fy.sessionTurn(s, 'result')
    await flush()
    const items = fy.feed().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 's:s1', text: 'Double jump added.', at: T0 + 10 * MIN })
    expect(items[0].seen).toBeUndefined()
    expect(fy.feed().pulse.delivered).toBe(2)
  })

  it('skips a compaction preamble, caps at 600 characters, falls back to the snapshot line', async () => {
    expect(lastWords([says('Real answer.'), says('This session is being continued from a previous conversation that ran out of context.')])).toBe('Real answer.')
    expect(lastWords([says('only me', 'user')])).toBeUndefined()
    const fy = make()
    threads.s1 = [says('x'.repeat(2000))]
    fy.sessionTurn(session(), 'result')
    await flush()
    const text = find(fy, 's:s1')!.text
    expect(text).toHaveLength(TEXT_MAX)
    expect(text.endsWith('…')).toBe(true)
    // A session of another machine whose thread cannot be read: what the snapshot says.
    fy.sessionTurn(session({ id: 'far', machineId: 'pc', lastMessage: 'done over there' }), 'result')
    await flush()
    expect(find(fy, 's:far')).toMatchObject({ text: 'done over there' })
  })

  it('reads the thread again a moment later: better words keep the item in place, seen or not', async () => {
    const fy = make()
    const s = session({ lastMessage: 'Running the last che' })
    threads.s1 = []
    fy.sessionTurn(s, 'result')
    await flush()
    expect(find(fy, 's:s1')?.text).toBe('Running the last che')
    fy.seen(['s:s1'])
    threads.s1 = [says('All checks pass.')]
    now = T0 + 4000
    later.forEach((fn) => fn())
    await flush()
    expect(find(fy, 's:s1')).toMatchObject({ text: 'All checks pass.', at: T0, seen: true })
  })

  it('attaches the files the last message cites (at most 4, this machine only)', async () => {
    const fy = make()
    for (const f of ['a.png', 'b.png', 'c.mp4', 'd.png', 'e.png']) shelf.known.add(`/home/u/projects/mygame/out/${f}`)
    threads.s1 = [says('Rendered out/a.png out/b.png out/c.mp4 out/d.png out/e.png and out/missing.png')]
    fy.sessionTurn(session(), 'result')
    await flush()
    expect(find(fy, 's:s1')?.media?.map((m) => m.name)).toEqual(['a.png', 'b.png', 'c.mp4', 'd.png'])
    expect(find(fy, 's:s1')?.media?.[2]).toMatchObject({ type: 'video', url: expect.stringMatching(/^\/api\/foryou\/media\//) })
    threads.far = threads.s1
    fy.sessionTurn(session({ id: 'far', machineId: 'pc' }), 'result')
    await flush()
    expect(find(fy, 's:far')?.media).toBeUndefined()
  })

  it('never takes a test brief, a one-shot call, weevils own folder or weevboss', async () => {
    const fy = make({ isTestBrief: (p) => !!p && p.startsWith('[test]') })
    transcripts.set('t1', { firstPrompt: '[test] probe' })
    transcripts.set('h1', { headless: true })
    transcripts.set('c1', { originator: 'codex_exec' })
    const out = [
      session({ id: 't1' }),
      session({ id: 't2', title: '[test] remote probe', machineId: 'pc' }),
      session({ id: 'h1' }),
      session({ id: 'c1' }),
      session({ id: 'h2', origin: 'headless' }),
      session({ id: 'd1', cwd: '/home/u/.local/share/weevils/titles' }),
      session({ id: 'boss' }),
    ]
    for (const s of out) {
      threads[s.id] = [says('I did things.')]
      expect(fy.eligible(s)).toBe(false)
      fy.sessionTurn(s, 'result')
      fy.sessionTurn({ ...s, status: 'needs_user', attention: 'ok?' }, 'question')
    }
    // Waiting or cut in the snapshot: still not in the stream, nor in the factory line.
    snap.sessions = out.map((s) => ({ ...s, status: 'needs_user' as const }))
    await flush()
    expect(fy.feed()).toMatchObject({ items: [], pulse: { waiting: 0 } })
    // A background task of the auto band is a session like another.
    const auto = session({ id: 'a1', cwd: '/home/u/projects/.auto/mygame/abc' })
    threads.a1 = [says('Tests hardened.')]
    fy.sessionTurn(auto, 'result')
    await flush()
    expect(ids(fy)).toEqual(['s:a1'])
  })
})

describe('sessions that wait or were cut', () => {
  it('a question shows once, as the session item, and leaves when the session moves on', async () => {
    const fy = make()
    const s = session({ status: 'needs_user', attention: 'Do you want to proceed?' })
    snap.sessions = [s]
    fy.sessionTurn(s, 'question')
    expect(fy.feed().items).toMatchObject([{ id: 's:s1', kind: 'session', tone: 'question', text: 'Do you want to proceed?', reply: 'session' }])
    expect(fy.feed().items.filter((i) => i.kind === 'alert')).toEqual([])
    snap.sessions = [session({ status: 'working' })]
    expect(fy.feed().items).toEqual([])
    threads.s1 = [says('Proceeded, all good.')]
    fy.sessionTurn(session(), 'result')
    await flush()
    expect(find(fy, 's:s1')).toMatchObject({ tone: 'result', text: 'Proceeded, all good.' })
  })

  it('after a restart, a session already waiting or cut gets its item at the first read', () => {
    snap.sessions = [session({ status: 'needs_user', attention: undefined, lastActivityAt: T0 - 5 * MIN }), session({ id: 's2', status: 'interrupted', interrupted: { at: T0 - HOUR, reason: 'quota' } })]
    const fy = make()
    const items = fy.feed().items
    expect(items.map((i) => [i.id, i.tone, i.text, i.at])).toEqual([
      ['s:s1', 'question', M.en.waiting, T0 - 5 * MIN],
      ['s:s2', 'alert', 'Cut off mid-work: usage limit reached.', T0 - HOUR],
    ])
    expect(items[1].actions).toEqual([{ id: 'resume', label: 'Resume' }])
    expect(fy.feed('fr' as never, 'fr').items[1]).toMatchObject({ text: 'Coupée en plein travail : limite d’usage atteinte.', actions: [{ id: 'resume', label: 'Reprendre' }] })
    // Dismissed: the same question does not come back at the next read.
    fy.dismiss('s:s1')
    expect(ids(fy)).toEqual(['s:s2'])
    expect(ids(make())).toEqual(['s:s2'])
  })

  it('« resume » resumes the session and the item leaves; the cut said by core is the same episode', async () => {
    const s = session({ status: 'interrupted', interrupted: { at: T0 - MIN, reason: 'died' }, lastActivityAt: T0 - MIN })
    snap.sessions = [s]
    const fy = make()
    fy.sessionTurn(s, 'cut')
    const rev = fy.feed().rev
    fy.sessionTurn(s, 'cut')
    expect(fy.feed().rev).toBe(rev)
    await fy.act('s:s1', 'resume')
    expect(host.resume).toHaveBeenCalledWith('s1')
    expect(fy.feed().items).toEqual([])
    await expect(fy.act('s:s1', 'resume')).rejects.toThrow(M.en.notFound)
  })
})

// ---------------------------------------------------------------- mail

describe('mail', () => {
  const mail = { author: 'gepetto', subject: 'menu  done', text: 'Hi,\n\n> you asked for the menu\nThe menu is in, with the three buttons.\nMore below.\n', target: 'weevboss', mid: '<m1@example.com>', address: 'gepetto@example.com' }

  it('records who, the subject, the first line that says something and the whole text', () => {
    const fy = make()
    fy.mail(mail)
    const [item] = fy.feed().items
    expect(item).toMatchObject({ kind: 'mail', tone: 'neutral', who: 'gepetto', title: 'menu done', text: 'The menu is in, with the three buttons.', body: mail.text.trim(), open: { page: 'boss' } })
    expect(firstLine('Bonjour Alex,\n\n' + 'a'.repeat(300))).toHaveLength(140)
    // The user's own mail (no author) is not news to them.
    fy.mail({ ...mail, author: '', mid: '<own@x>' })
    expect(fy.feed().items).toHaveLength(1)
    // Once the session exists, the same mail points at it.
    snap.sessions = [session()]
    fy.mail({ ...mail, target: 's1' })
    expect(fy.feed().items).toMatchObject([{ id: item.id, open: { page: 'session', id: 's1' }, sessionId: 's1', projectId: 'mygame' }])
  })

  it('the sender address stays on the server: in the file, never in what the app reads', () => {
    const write = vi.fn(async () => true)
    const fy = make({ mail: () => ({ write }) })
    fy.mail(mail)
    expect(fs.readFileSync(fy.file, 'utf8')).toContain('gepetto@example.com')
    const read = JSON.stringify([fy.feed(), fy.feed(now, 'fr'), fy.recent(['mail']), fy.mark(snap)])
    expect(read).not.toContain('gepetto@example.com')
    expect(read).not.toContain('<m1@example.com>')
    expect(read).not.toContain('"mail":{')
  })

  it('a reply goes by mail to the author in the same thread; without a bridge the item has no reply', async () => {
    const write = vi.fn(async (_o: { to: string; subject: string; text: string; inReplyTo: string; author: string; target: string }) => true)
    let out: { write: typeof write } | null = null
    const fy = make({ mail: () => out })
    fy.mail(mail)
    const id = fy.feed().items[0].id
    expect(fy.feed().items[0].reply).toBeUndefined()
    await expect(fy.reply(id, 'thanks')).rejects.toThrow(M.en.mailOff)
    out = { write }
    expect(fy.feed().items[0].reply).toBe('mail')
    await fy.reply(id, ' thanks ')
    expect(write).toHaveBeenCalledWith({ to: 'gepetto@example.com', subject: 'menu  done', text: 'thanks', inReplyTo: '<m1@example.com>', author: 'gepetto', target: 'weevboss' })
    expect(host.sendMain).not.toHaveBeenCalled()
    write.mockResolvedValueOnce(false)
    await expect(fy.reply(id, 'again')).rejects.toThrow(M.en.noReply)
  })
})

// ---------------------------------------------------------------- weevboss's posts

describe('posts', () => {
  it('a post: weevboss by default, capped, three buttons at most, their briefs never sent to the app', () => {
    const fy = make()
    const item = fy.post(`  ${'w'.repeat(1500)}  `, [{ label: 'Ship it', brief: 'merge and deploy' }, { label: 'x', brief: '' }, { label: 'B', brief: 'b' }, { label: 'C', brief: 'c' }, { label: 'D', brief: 'd' }])
    expect(item).toMatchObject({ kind: 'boss', who: 'weevboss', reply: 'boss', open: { page: 'boss' }, actions: [{ id: 'a1', label: 'Ship it' }, { id: 'a2', label: 'B' }, { id: 'a3', label: 'C' }] })
    expect(item.text).toHaveLength(1200)
    expect(JSON.stringify(fy.feed())).not.toContain('merge and deploy')
    expect(fy.post('from a friend', undefined, 'gepetto').who).toBe('gepetto')
    expect(() => fy.post('   ')).toThrow(M.en.emptyText)
  })

  it('a tapped button sends its brief to weevboss behind a short visible message, then the item leaves', async () => {
    const fy = make()
    const { id } = fy.post('Three things are ready.', [{ label: 'Ship it', brief: 'merge and deploy' }])
    await expect(fy.act(id, 'a9')).rejects.toThrow(M.en.noAction)
    await fy.act(id, 'a1', undefined, 'fr')
    expect(host.sendMain).toHaveBeenCalledWith('Vas-y : Ship it', M.fr.actBrief('Three things are ready.', 'merge and deploy'))
    expect(fy.feed().items).toEqual([])
    await expect(fy.act(id, 'a1')).rejects.toThrow(M.en.notFound)
  })

  it('a reply is a real message to weevboss, with the post as a hidden note', async () => {
    const fy = make()
    const { id } = fy.post('Three things are ready.')
    await fy.reply(id, 'which ones?')
    expect(host.sendMain).toHaveBeenCalledWith('which ones?', M.en.replyBrief('Three things are ready.'))
    expect(find(fy, id)?.seen).toBe(true)
    await expect(fy.reply(id, '  ')).rejects.toThrow(M.en.emptyText)
  })

  it('a reply under a session item goes to that session, as the user', async () => {
    const fy = make()
    threads.s1 = [says('Done.')]
    fy.sessionTurn(session(), 'result')
    await flush()
    await fy.reply('s:s1', 'and the tests?')
    expect(host.send).toHaveBeenCalledWith('s1', 'and the tests?')
  })

  it('the seam for generated items: language kept, hidden from another language, « more » waits for the curator', async () => {
    const fy = make()
    const item = fy.add({ kind: 'insight', projectId: 'mygame', text: 'Vite pré-bundle les dépendances.', more: true, lang: 'fr' })!
    expect(fy.feed().items).toEqual([])
    expect(fy.mark(snap).unseen).toBe(0)
    expect(fy.feed(now, 'fr').items).toMatchObject([{ id: item.id, kind: 'insight', more: true }])
    await expect(fy.more(item.id)).rejects.toThrow(M.en.noMore)
    fy.curator = { more: vi.fn(async () => ' Longer answer. ') }
    expect(await fy.more(item.id)).toBe('Longer answer.')
    expect(await fy.more(item.id)).toBe('Longer answer.')
    expect(fy.curator.more).toHaveBeenCalledTimes(1)
    expect(fy.feed(now, 'fr').items[0].moreText).toBe('Longer answer.')
    expect(fy.recent(['insight'])).toHaveLength(1)
    expect(fy.wanted()).toBe(true)
  })
})

// ---------------------------------------------------------------- media

describe('media', () => {
  it('« weevils show »: the item finds its session by folder; files shown within two minutes join it', () => {
    const fy = make()
    snap.sessions = [session({ id: 'old', lastActivityAt: T0 - HOUR }), session({ lastActivityAt: T0 }), session({ id: 'other', cwd: '/home/u/projects/site' })]
    for (const f of ['a.png', 'b.mp4', 'c.png']) shelf.known.add(`/home/u/projects/mygame/out/${f}`)
    const a = fy.addMedia({ path: 'a.png', caption: 'The new menu', cwd: '/home/u/projects/mygame/out' })
    expect(a).toMatchObject({ kind: 'media', tone: 'result', who: 'session', sessionId: 's1', projectId: 'mygame', title: 'The new menu', reply: 'session', open: { page: 'session', id: 's1' } })
    expect(a.media).toHaveLength(1)
    fy.seen([a.id])
    now = T0 + MIN
    const b = fy.addMedia({ path: 'b.mp4', cwd: '/home/u/projects/mygame/out' })
    expect(b.id).toBe(a.id)
    expect(b.media?.map((m) => m.type)).toEqual(['image', 'video'])
    expect(b).toMatchObject({ title: 'The new menu', at: T0 + MIN })
    expect(b.seen).toBeUndefined()
    now = T0 + MIN + MEDIA_JOIN_MS + 1
    expect(fy.addMedia({ path: 'c.png', cwd: '/home/u/projects/mygame/out' }).id).not.toBe(a.id)
    expect(() => fy.addMedia({ path: 'nope.png', cwd: '/home/u/projects/mygame' })).toThrow('not a file weevils can show')
  })

  it('one item holds six files at most; no session: weevboss from its folder, else weevils', () => {
    const fy = make()
    for (let i = 0; i < 8; i++) shelf.known.add(`/home/u/.local/share/weevils/orchestrateur/${i}.png`)
    const got = Array.from({ length: 8 }, (_, i) => fy.addMedia({ path: `${i}.png`, cwd: '/home/u/.local/share/weevils/orchestrateur' }))
    expect(got[5].media).toHaveLength(MAX_MEDIA)
    expect(got[6].id).not.toBe(got[0].id)
    expect(got[0]).toMatchObject({ who: 'weevboss', tone: 'neutral', reply: 'boss', open: { page: 'boss' } })
    shelf.known.add('/tmp/x.png')
    expect(fy.addMedia({ path: '/tmp/x.png', cwd: '/tmp' })).toMatchObject({ who: 'weevils' })
    expect(() => make({ shelf: null }).addMedia({ path: '/tmp/x.png' })).toThrow(M.en.noMedia)
  })
})

// ---------------------------------------------------------------- live items

describe('alerts', () => {
  const usage = (percent: number, resetsAt = T0 + HOUR): UsageInfo => ({
    claude: { ok: true, windows: [{ kind: 'session', percent, resetsAt }, { kind: 'week', percent: 40, resetsAt: null }], source: 't', at: T0 },
    codex: { ok: false, windows: [], source: 't', at: T0 },
  })

  it('a usage window at 85 % or more: asked in the background, shown at the next read, gone with its cause', async () => {
    let u = usage(92)
    const fy = make({ quotas: async () => u })
    // The read that asks never waits for the answer.
    expect(fy.feed().items).toEqual([])
    await flush()
    expect(host.bump).toHaveBeenCalled()
    const [a] = fy.feed().items
    expect(a).toMatchObject({ id: `alert:usage:claude:session::${T0 + HOUR}`, kind: 'alert', tone: 'alert', who: 'weevils', text: 'Claude: 5 h window at 92%', open: { page: 'usage' }, live: true, at: T0 })
    expect(fy.feed(now, 'fr').items[0].text).toBe('Claude : fenêtre de 5 h à 92 %')
    expect(JSON.parse(fs.readFileSync(fy.file, 'utf8')).items).toEqual([])
    u = usage(12)
    now = T0 + REFRESH_MS + 1
    fy.feed()
    await flush()
    expect(fy.feed().items).toEqual([])
  })

  it('a machine saturated twice in a row, a full disk, a machine offline for two minutes, a failed auto task', async () => {
    let states: MachineState[] = [{ id: 'test', name: 'vps', level: 'crit', disk: 93 }]
    const fy = make({ machines: async () => states })
    snap.machines.push({ id: 'pc', name: 'pc', online: false })
    snap.optimizers = [optimizer({ id: 'bad', state: 'failed', endedAt: T0 - HOUR, lastEvent: 'stopped after 2 h' }), optimizer({ id: 'old', state: 'failed', endedAt: T0 - 25 * HOUR })]
    fy.feed()
    await flush()
    // One peak is not an alert; the tunnel may hiccup.
    expect(ids(fy)).toEqual(['alert:disk:test', 'alert:auto:bad'])
    expect(find(fy, 'alert:auto:bad')).toMatchObject({ text: 'Auto task failed: Harden the tests (stopped after 2 h)', open: { page: 'auto', id: 'bad' }, at: T0 - HOUR })
    now = T0 + REFRESH_MS + 1
    fy.feed()
    await flush()
    expect(ids(fy).sort()).toEqual(['alert:auto:bad', 'alert:disk:test', 'alert:machine:test', 'alert:offline:pc'])
    expect(find(fy, 'alert:offline:pc')).toMatchObject({ text: 'pc is offline', open: { page: 'machine' }, at: T0 })
    expect(now - T0).toBeGreaterThanOrEqual(OFFLINE_AFTER_MS)
    states = [{ id: 'test', name: 'vps', level: 'ok', disk: 40 }]
    snap.machines[1].online = true
    snap.optimizers = []
    now += REFRESH_MS + 1
    fy.feed()
    await flush()
    expect(fy.feed().items).toEqual([])
  })

  it('seen and dismissed are kept by id, across a restart, while the cause lasts', async () => {
    snap.optimizers = [optimizer({ id: 'bad', state: 'failed', endedAt: T0 - HOUR }), optimizer({ id: 'bad2', state: 'failed', endedAt: T0 - HOUR })]
    const fy = make()
    expect(fy.mark(snap).unseen).toBe(2)
    fy.seen(['alert:auto:bad'])
    expect(fy.dismiss('alert:auto:bad2')).toBe(true)
    expect(fy.dismiss('alert:auto:never')).toBe(false)
    const again = make()
    expect(again.feed().items).toMatchObject([{ id: 'alert:auto:bad', seen: true }])
    expect(again.mark(snap).unseen).toBe(0)
  })
})

describe('proposals', () => {
  const unmanaged = () => session({ id: 'u1', title: 'left open', controllable: false, status: 'idle', lastActivityAt: T0 - 13 * HOUR })
  const tips: ForYouDeps['tips'] = (s, at) => ({ snap: s, now: at, loads: [], dictation: false, reapMs: 24 * HOUR })

  it('one item: proposed auto tasks first, then the tips that act on the server or through weevboss; four cards at most', () => {
    const fy = make({ tips })
    expect(fy.feed().items).toEqual([])
    snap.optimizers = [optimizer(), optimizer({ id: 'o2', title: 'Watch fairs', kind: 'watch' }), optimizer({ id: 'run', state: 'running' }), optimizer({ id: 'q', state: 'queued' })]
    snap.sessions = [unmanaged(), session({ id: 'i1', status: 'done', lastActivityAt: T0 - 13 * HOUR })]
    const [p] = fy.feed().items
    expect(p).toMatchObject({ id: 'proposals', kind: 'proposals', who: 'weevils', live: true, text: '4 proposals', at: T0 })
    // Tips that only open a page of the app (no dictation, one machine) stay in the app.
    expect(p.cards?.map((c) => [c.id.slice(0, 2), c.source, c.kind])).toEqual([['o:', 'optimizer', 'tests'], ['o:', 'optimizer', 'watch'], ['t:', 'tip', 'idle-sessions'], ['t:', 'tip', 'idle-unmanaged']])
    expect(p.cards?.[2]).toMatchObject({ title: TM.en.idleSessions(1, true), accept: TM.en.closeThem(1) })
    expect(fy.feed().pulse.auto).toBe(2)
    snap.optimizers.push(optimizer({ id: 'o3' }), optimizer({ id: 'o4' }), optimizer({ id: 'o5' }))
    expect(fy.feed().items[0].cards).toHaveLength(MAX_CARDS)
    expect(fy.feed(now, 'fr').items[0].text).toBe('4 propositions')
  })

  it('accept / refuse go through the auto band; an answered card never comes back, even after a restart', async () => {
    const auto = { accept: vi.fn(() => true), refuse: vi.fn(() => true) }
    const fy = make({ tips, optimizers: () => auto })
    snap.optimizers = [optimizer(), optimizer({ id: 'o2' })]
    await fy.act('proposals', 'accept', 'o:o1')
    expect(auto.accept).toHaveBeenCalledWith('o1')
    // The band still says « proposed » until its next tick: the card is already gone.
    expect(fy.feed().items[0].cards?.map((c) => c.id)).toEqual(['o:o2'])
    await fy.act('proposals', 'refuse', 'o:o2')
    expect(auto.refuse).toHaveBeenCalledWith('o2')
    expect(fy.feed().items).toEqual([])
    expect(make({ tips }).feed().items).toEqual([])
    await expect(fy.act('proposals', 'accept', 'o:o1')).rejects.toThrow(M.en.cardGone)
    auto.accept.mockReturnValueOnce(false)
    snap.optimizers = [optimizer({ id: 'o9' })]
    await expect(fy.act('proposals', 'accept', 'o:o9')).rejects.toThrow(M.en.cardGone)
    await expect(fy.act('proposals', 'launch', 'o:o9')).rejects.toThrow(M.en.noAction)
  })

  it('a tip accepted runs on the server or goes to weevboss; refused, it is only remembered', async () => {
    const fy = make({ tips })
    snap.sessions = [unmanaged(), session({ id: 'i1', status: 'done', lastActivityAt: T0 - 13 * HOUR }), session({ id: 'i2', status: 'idle', lastActivityAt: T0 - 14 * HOUR })]
    const cards = fy.feed().items[0].cards!
    const closing = cards.find((c) => c.kind === 'idle-sessions')!
    const asking = cards.find((c) => c.kind === 'idle-unmanaged')!
    await fy.act('proposals', 'accept', closing.id)
    expect(host.close.mock.calls.map((c) => c[0]).sort()).toEqual(['i1', 'i2'])
    await fy.act('proposals', 'refuse', asking.id)
    expect(host.sendMain).not.toHaveBeenCalled()
    expect(fy.feed().items).toEqual([])
    // Another situation, another card: accepted, weevboss gets the prepared message.
    snap.sessions.push(session({ id: 'u2', controllable: false, status: 'idle', lastActivityAt: T0 - 20 * HOUR }))
    const next = fy.feed().items[0].cards!.find((c) => c.kind === 'idle-unmanaged')!
    await fy.act('proposals', 'accept', next.id)
    expect(host.sendMain).toHaveBeenCalledTimes(1)
    expect(host.sendMain.mock.calls[0][0]).toContain('left open')
  })

  it('dismissed, the band comes back unseen when a new card arrives', () => {
    const fy = make()
    snap.optimizers = [optimizer()]
    fy.feed()
    fy.seen(['proposals'])
    fy.dismiss('proposals')
    expect(fy.feed().items).toEqual([])
    now = T0 + HOUR
    snap.optimizers.push(optimizer({ id: 'o2' }))
    const [p] = fy.feed().items
    expect(p).toMatchObject({ id: 'proposals', at: T0 + HOUR })
    expect(p.seen).toBeUndefined()
  })
})

// ---------------------------------------------------------------- revision, unseen, restart

describe('the mark in the snapshot', () => {
  it('rev moves at every visible change, live ones included, and only then', () => {
    const fy = make()
    const r0 = fy.mark(snap).rev
    expect(fy.mark(snap)).toEqual({ rev: r0, unseen: 0 })
    fy.post('one')
    const r1 = fy.mark(snap).rev
    expect(r1).toBe(r0 + 1)
    expect(fy.mark(snap)).toEqual({ rev: r1, unseen: 1 })
    // A live item comes, then leaves: each time one revision, counted while the snapshot is built (no bump from there).
    host.bump.mockClear()
    snap.optimizers = [optimizer()]
    expect(fy.mark(snap)).toEqual({ rev: r1 + 1, unseen: 2 })
    expect(fy.mark(snap).rev).toBe(r1 + 1)
    snap.optimizers = []
    expect(fy.mark(snap)).toEqual({ rev: r1 + 2, unseen: 1 })
    expect(host.bump).not.toHaveBeenCalled()
    // Found while answering the app instead: the snapshot is asked to follow.
    snap.optimizers = [optimizer()]
    expect(fy.feed().rev).toBe(r1 + 3)
    expect(host.bump).toHaveBeenCalledTimes(1)
    // The language of the reader does not move the revision.
    fy.add({ kind: 'insight', text: 'Une chose vraie.', lang: 'fr' })
    const r = fy.mark(snap).rev
    expect(fy.feed(now, 'fr').rev).toBe(r)
    expect(fy.feed(now, 'en').rev).toBe(r)
    expect(fy.mark(snap).rev).toBe(r)
  })

  it('seen on a device is seen everywhere, dismissed stays dismissed, the revision goes on after a restart', async () => {
    const fy = make()
    const a = fy.post('first')
    const b = fy.post('second')
    threads.s1 = [says('Done.')]
    fy.sessionTurn(session(), 'result')
    await flush()
    fy.seen([a.id, 'unknown'])
    fy.dismiss(b.id)
    const { rev } = fy.mark(snap)
    expect(fy.mark(snap).unseen).toBe(1)
    const again = make()
    expect(again.mark(snap)).toEqual({ rev, unseen: 1 })
    expect(again.feed().items.map((i) => [i.id, !!i.seen]).sort()).toEqual([[a.id, true], ['s:s1', false]].sort())
    expect(again.has(b.id)).toBe(false)
    expect(again.dismiss('nope')).toBe(false)
    // The dismissed item of a session is replaced by its next turn.
    again.dismiss('s:s1')
    threads.s1.push(says('Second pass done.'))
    again.sessionTurn(session(), 'result')
    await flush()
    expect(find(again, 's:s1')?.text).toBe('Second pass done.')
  })

  it('the factory line: working, waiting (asking or cut), delivered today, auto tasks', async () => {
    const fy = make()
    snap.sessions = [session({ id: 'w1', status: 'working' }), session({ id: 'w2', status: 'working' }), session({ id: 'n1', status: 'needs_user' }), session({ id: 'c1', status: 'interrupted', interrupted: { at: T0, reason: 'api' } }), session({ id: 'd1' })]
    snap.optimizers = [optimizer({ state: 'running' }), optimizer({ id: 'q', state: 'queued' }), optimizer({ id: 'p' })]
    threads.d1 = [says('Done.')]
    fy.sessionTurn(snap.sessions[4], 'result')
    await flush()
    expect(fy.feed().pulse).toEqual({ working: 2, waiting: 2, delivered: 1, auto: 2 })
    now = T0 + 24 * HOUR
    expect(fy.feed().pulse.delivered).toBe(0)
  })
})

// ---------------------------------------------------------------- order and pace

describe('arrange', () => {
  let n = 0
  const item = (kind: ForYouKind, over: Partial<ForYouItem> = {}): ForYouItem => ({ id: `${kind}-${n++}`, kind, tone: 'neutral', at: T0 - MIN, who: 'x', text: '', ...over })
  const kinds = (list: ForYouItem[]) => list.map((i) => i.kind)
  const pairs = (list: ForYouItem[]) => list.filter((x, i) => i > 0 && list[i - 1].kind === x.kind).length
  /** Deterministic pseudo-random numbers (the property tests must not flake). */
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

  it('scores: what needs the user first, freshness halves every six hours, seen counts for less', () => {
    const order = [item('alert'), item('session', { tone: 'question' }), item('session', { tone: 'alert' }), item('mail'), item('session', { tone: 'result' }), item('boss'), item('proposals'), item('media'), item('improve'), item('insight')]
    const scores = order.map((i) => score(i, T0))
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    const mail = item('mail', { at: T0 })
    expect(score({ ...mail, at: T0 - 6 * HOUR }, T0)).toBeCloseTo(score(mail, T0) / 2)
    expect(score({ ...mail, seen: true }, T0)).toBeLessThan(score(mail, T0))
    // A question still waiting does not fade for a day.
    const q = item('session', { tone: 'question', at: T0 - 20 * HOUR })
    expect(score(q, T0)).toBe(score({ ...q, at: T0 }, T0))
  })

  it('alerts first, then a fresh unseen media, the proposals around third place', () => {
    const list = [item('session', { tone: 'result' }), item('mail'), item('boss'), item('proposals'), item('media', { at: T0 - 10 * MIN }), item('alert', { at: T0 - HOUR }), item('alert', { at: T0 }), item('session', { tone: 'question' })]
    const out = arrange(list, T0)
    expect(kinds(out).slice(0, 3)).toEqual(['alert', 'alert', 'media'])
    expect(out.findIndex((i) => i.kind === 'proposals')).toBe(2 + PROPOSALS_SLOT)
    expect(out[3]).toMatchObject({ kind: 'session', tone: 'question' })
    expect(out).toHaveLength(list.length)
    // Seen, or older than two hours: the media takes its place by score.
    const seen = arrange(list.map((i) => (i.kind === 'media' ? { ...i, seen: true } : i)), T0)
    expect(seen[2].kind).not.toBe('media')
    const old = arrange(list.map((i) => (i.kind === 'media' ? { ...i, at: T0 - FRESH_MEDIA_MS - 1 } : i)), T0)
    expect(old[2].kind).not.toBe('media')
    // With few items the proposals still show, at the end.
    expect(kinds(arrange([item('proposals'), item('mail')], T0))).toEqual(['mail', 'proposals'])
  })

  it('unseen before seen within reason: a fresh seen item still beats a stale unseen one', () => {
    const a = item('boss', { at: T0 - MIN, seen: true })
    const b = item('boss', { at: T0 - 2 * MIN })
    const stale = item('boss', { at: T0 - 30 * HOUR })
    expect(arrange([a, b, stale], T0).map((i) => i.id)).toEqual([b.id, a.id, stale.id])
  })

  it('never two of a kind in a row when another order avoids it', () => {
    const random = rng(7)
    const pool: ForYouKind[] = ['session', 'mail', 'boss', 'media', 'improve']
    for (let round = 0; round < 300; round++) {
      const size = 1 + Math.floor(random() * 14)
      const skew = random()
      const list = Array.from({ length: size }, () =>
        item(random() < skew ? 'session' : pool[Math.floor(random() * pool.length)], { at: T0 - Math.floor(random() * 40 * HOUR), seen: random() < 0.3 }),
      )
      const out = arrange(list, T0)
      expect(out.map((i) => i.id).sort()).toEqual(list.map((i) => i.id).sort())
      const top = Math.max(...pool.map((k) => list.filter((i) => i.kind === k).length))
      // The fewest pairs any order can reach: what the most frequent kind forces.
      expect(pairs(out)).toBe(Math.max(0, 2 * top - size - 1))
    }
  })

  it('a fresh media does not lead when that would put two of a kind side by side', () => {
    const list = [item('media', { at: T0 - MIN }), item('media', { at: T0 - 3 * HOUR }), item('session', { at: T0 }), item('session', { at: T0 - MIN }), item('session', { at: T0 - 2 * MIN })]
    const out = arrange(list, T0)
    expect(kinds(out)).toEqual(['session', 'media', 'session', 'media', 'session'])
  })

  it('an insight, a milestone or a stat only every few items, the rest at the end', () => {
    const deep = [item('insight', { at: T0 }), item('milestone', { at: T0 }), item('stat', { at: T0 })]
    const plain = Array.from({ length: 9 }, (_, i) => item(i % 2 ? 'mail' : 'boss', { at: T0 - i * MIN }))
    const out = kinds(arrange([...deep, ...plain], T0))
    const at = out.map((k, i) => (k === 'insight' || k === 'milestone' || k === 'stat' ? i : -1)).filter((i) => i >= 0)
    expect(at).toEqual([DEEP_GAP, 2 * DEEP_GAP + 1, 11])
    // Nothing else to show: they come anyway.
    expect(kinds(arrange([deep[0], deep[1]], T0)).sort()).toEqual(['insight', 'milestone'])
  })

  it('same input, same order, whatever the order it came in', () => {
    const random = rng(3)
    const list = Array.from({ length: 30 }, (_, i) => item((['session', 'mail', 'boss', 'media', 'insight', 'alert'] as ForYouKind[])[i % 6], { at: T0 - (i % 4) * HOUR, seen: i % 5 === 0 }))
    list.push(item('proposals'))
    const want = arrange(list, T0).map((i) => i.id)
    expect(arrange(list, T0).map((i) => i.id)).toEqual(want)
    for (let round = 0; round < 10; round++) {
      const shuffled = [...list].sort(() => random() - 0.5)
      expect(arrange(shuffled, T0).map((i) => i.id)).toEqual(want)
    }
    expect(list.map((i) => i.id)).toEqual([...list].map((i) => i.id))
  })
})

// ---------------------------------------------------------------- routes

describe('routes', () => {
  const local = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:4179' } }
  const phone = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'weevils.example.com', 'x-forwarded-for': '203.0.113.7', cookie: 'wv=valid' } }
  const call = async (fy: ForYou, method: string, url: string, body: unknown = {}, req: unknown = phone) => {
    const got = { status: 0, body: undefined as any }
    const routes = foryouRoutes(fy, (_res, status, b) => void ((got.status = status), (got.body = b)), async () => body)
    const u = new URL(url, 'http://x')
    for (const [m, re, handler] of routes) {
      const hit = m === method ? re.exec(u.pathname) : null
      if (!hit) continue
      await handler(req as never, {} as never, u, hit.slice(1))
      return got
    }
    return { status: 404, body: { error: 'no route' } }
  }

  it('post and media: from this machine only, whatever « from » the request claims', async () => {
    const fy = make()
    shelf.known.add('/home/u/projects/mygame/a.png')
    expect(await call(fy, 'POST', '/api/foryou/post', { text: 'hi', from: 'weevboss' })).toEqual({ status: 403, body: { error: M.en.localOnly } })
    expect(await call(fy, 'POST', '/api/foryou/media', { path: '/home/u/projects/mygame/a.png' })).toEqual({ status: 403, body: { error: M.en.localOnly } })
    // A page of another local server (another port) is not this machine's CLI either.
    const page = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:4179', origin: 'http://127.0.0.1:4173' } }
    expect((await call(fy, 'POST', '/api/foryou/post', { text: 'hi' }, page)).status).toBe(403)
    expect(fy.feed().items).toEqual([])
    const posted = await call(fy, 'POST', '/api/foryou/post', { text: 'hi', actions: [{ label: 'Go', brief: 'do it' }], from: 'weevils' }, local)
    expect(posted).toMatchObject({ status: 200, body: { item: { kind: 'boss', who: 'weevboss', text: 'hi', actions: [{ id: 'a1', label: 'Go' }] } } })
    expect(await call(fy, 'POST', '/api/foryou/post', { text: '' }, local)).toEqual({ status: 400, body: { error: M.en.emptyText } })
    expect(await call(fy, 'POST', '/api/foryou/media', { path: '/home/u/projects/mygame/a.png', caption: 'menu', cwd: '/home/u/projects/mygame' }, local)).toMatchObject({ status: 200, body: { item: { kind: 'media', title: 'menu' } } })
    expect(await call(fy, 'POST', '/api/foryou/media', { path: '/etc/passwd' }, local)).toMatchObject({ status: 400 })
  })

  it('the stream, seen, dismiss, act, reply, more and the bytes', async () => {
    const fy = make()
    const { id } = fy.post('Three things.', [{ label: 'Go', brief: 'do it' }])
    expect(fy.lastWanted).toBe(0)
    const feed = await call(fy, 'GET', '/api/foryou?lang=fr')
    expect(feed).toMatchObject({ status: 200, body: { items: [{ id }], pulse: { working: 0 } } })
    expect(fy.lastWanted).toBe(T0)
    expect(await call(fy, 'POST', '/api/foryou/seen', { ids: [id] })).toEqual({ status: 200, body: { ok: true } })
    expect(find(fy, id)?.seen).toBe(true)
    expect(await call(fy, 'POST', `/api/foryou/${encodeURIComponent(id)}/reply`, { text: 'ok' })).toEqual({ status: 200, body: { ok: true } })
    expect(host.sendMain).toHaveBeenCalledWith('ok', expect.any(String))
    expect(await call(fy, 'POST', `/api/foryou/${encodeURIComponent(id)}/reply`, { text: '' })).toEqual({ status: 400, body: { error: M.en.emptyText } })
    expect(await call(fy, 'POST', `/api/foryou/${encodeURIComponent(id)}/more`)).toEqual({ status: 400, body: { error: M.en.noMore } })
    expect(await call(fy, 'POST', `/api/foryou/${encodeURIComponent(id)}/act?lang=fr`, { action: 'nope' })).toEqual({ status: 400, body: { error: M.fr.noAction } })
    expect(await call(fy, 'POST', `/api/foryou/${encodeURIComponent(id)}/act`, { action: 'a1' })).toEqual({ status: 200, body: { ok: true } })
    expect(await call(fy, 'POST', `/api/foryou/${encodeURIComponent(id)}/act`, { action: 'a1' })).toEqual({ status: 404, body: { error: M.en.notFound } })
    expect(await call(fy, 'POST', '/api/foryou/b%3Anope/dismiss')).toEqual({ status: 404, body: { error: M.en.notFound } })
    // Ids with colons travel encoded.
    snap.optimizers = [optimizer({ id: 'bad', state: 'failed', endedAt: T0 })]
    fy.feed()
    expect(await call(fy, 'POST', '/api/foryou/alert%3Aauto%3Abad/dismiss')).toEqual({ status: 200, body: { ok: true } })
    expect(fy.feed().items).toEqual([])
    await call(fy, 'GET', '/api/foryou/media/abc123')
    expect(shelf.served).toEqual(['abc123'])
    expect(await call(make({ shelf: null }), 'GET', '/api/foryou/media/abc123')).toEqual({ status: 404, body: { error: M.en.noMedia } })
  })
})

// ---------------------------------------------------------------- the hooks in core.ts

describe('wired into core', async () => {
  const { Weevils, isTestBrief } = await import('./core.ts')
  const { DATA_DIR, HOME } = await import('./config.ts')
  type Transcript = import('./transcripts.ts').Transcript
  const cwd = path.join(HOME, 'projects', 'demo')
  const ALIVE = process.pid
  const DEAD = spawnSync('true').pid
  let w: InstanceType<typeof Weevils>
  let fy: ForYou
  const transcript = (over: Partial<Transcript> = {}): Transcript => {
    const id = over.id ?? 's1'
    return { id, tool: 'claude', file: `/nowhere/${id}.jsonl`, cwd, openedAt: T0 - 2 * MIN, lastActivityAt: T0 - MIN, workStartedAt: null, phase: 'idle', firstPrompt: 'earlier', messages: [{ id: `${id}-m0`, role: 'user', text: 'earlier', at: T0 - MIN }], subagents: [], offset: 0, partial: '', queued: [], ...over }
  }
  const put = (t: Transcript) => (w.store.byFile.set(t.file, t), t)
  const settle = () => vi.advanceTimersByTimeAsync(250)

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 })
    for (const f of Object.values(mux)) f.mockReset()
    mux.capture.mockResolvedValue('')
    mux.listWv.mockResolvedValue([])
    fs.mkdirSync(cwd, { recursive: true })
    fs.rmSync(path.join(DATA_DIR, 'state.json'), { force: true })
    w = new Weevils()
    fy = new ForYou(w, { file: path.join(dir, 'foryou.json'), shelf: null, isTestBrief })
    w.foryou = fy
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('a turn that ends and a question enter the stream without any push; the first pass after a start is silent', async () => {
    put(transcript())
    put(transcript({ id: 'probe', file: '/nowhere/probe.jsonl', firstPrompt: '[test] probe' }))
    w.panes = [{ name: 'wv-demo-abc123', tool: 'claude', sessionId: 's1', title: 't', cwd, createdAt: T0 - MIN }, { name: 'wv-demo-def456', tool: 'claude', sessionId: 'probe', title: 't', cwd, createdAt: T0 - MIN }]
    w.hooks.set('s1', { event: 'Stop', at: T0 - MIN, pid: ALIVE })
    w.hooks.set('probe', { event: 'Stop', at: T0 - MIN, pid: ALIVE })
    w.bump()
    await settle()
    expect(w.push.enabled).toBe(false)
    expect(fy.feed().items).toEqual([])
    expect(w.snapshot().foryou).toEqual({ rev: 0, unseen: 0 })
    // A short turn (under the 15 s of the push) is still a result.
    for (const id of ['s1', 'probe']) w.hook({ session_id: id, hook_event_name: 'UserPromptSubmit' })
    await settle()
    await vi.advanceTimersByTimeAsync(5000)
    for (const id of ['s1', 'probe']) {
      const t = w.store.get(id)!
      t.messages.push({ id: `${id}-a1`, role: 'assistant', text: 'All three buttons are in.', at: Date.now() })
      t.lastActivityAt = Date.now()
      w.hook({ session_id: id, hook_event_name: 'Stop' })
    }
    await settle()
    expect(fy.feed().items).toMatchObject([{ id: 's:s1', kind: 'session', tone: 'result', text: 'All three buttons are in.', projectId: 'demo' }])
    expect(w.snapshot().foryou).toMatchObject({ unseen: 1 })
    expect(w.snapshot().foryou!.rev).toBeGreaterThan(0)
    // Nothing of the stream but its mark rides in the snapshot.
    expect(JSON.stringify(w.snapshot())).not.toContain('"kind":"session"')
    w.hook({ session_id: 's1', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' })
    await settle()
    expect(fy.feed().items).toMatchObject([{ id: 's:s1', tone: 'question', text: 'Claude needs your permission to use Bash' }])
    expect(fy.feed().pulse).toMatchObject({ waiting: 1 })
  })

  it('a cut enters the stream with its reason and « resume »; a mail told by the bridge is kept', async () => {
    put(transcript({ phase: 'working', lastActivityAt: T0 - MIN, messages: [{ id: 'm', role: 'user', text: 'build the page', at: T0 - MIN }] }))
    w.hooks.set('s1', { event: 'PostToolUse', at: T0 - MIN, pid: DEAD })
    w.bump()
    await settle()
    expect(fy.feed().items).toMatchObject([{ id: 's:s1', tone: 'alert', text: 'Cut off mid-work: process stopped.', actions: [{ id: 'resume', label: 'Resume' }] }])
    w.mailed({ author: 'gepetto', subject: 'done', text: 'The page is built.', target: 'weevboss', mid: '<m@x>', address: 'g@example.com' })
    expect(fy.feed().items.map((i) => i.kind).sort()).toEqual(['mail', 'session'])
    expect(JSON.stringify(fy.feed())).not.toContain('g@example.com')
  })
})
