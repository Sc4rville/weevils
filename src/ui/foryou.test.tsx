// @vitest-environment happy-dom
// The « for you » page: each kind of item shows its essentials, what can be done from the stream calls the right route
// (accept a card, reply, more), a mail unfolds in place, a session's head opens the real conversation.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../../shared/api.ts'
import type { ForYouFeed, ForYouItem } from '../../shared/foryou.ts'

const receipts = vi.hoisted(() => ({ rows: [] as any[] }))
vi.mock('../outbox', async original => ({ ...await original<typeof import('../outbox')>(), useOutbox: () => receipts.rows }))

const srv = vi.hoisted(() => ({ feed: null as unknown, calls: [] as string[], result: {} as Record<string, unknown>, fail: '', gate: null as Promise<void> | null }))
vi.mock('../api', () => {
  const run = async (what: string) => {
    srv.calls.push(what)
    if (srv.gate && /^(act|reply) /.test(what)) await srv.gate
    if (srv.fail && what.startsWith(srv.fail)) throw new Error('refused by the server')
    return { ok: true as const, ...srv.result }
  }
  return {
    api: {
      foryou: async () => (srv.calls.push('feed'), srv.feed),
      foryouSeen: (ids: string[]) => run(`seen ${ids.join(',')}`),
      foryouDismiss: (id: string) => run(`dismiss ${id}`),
      foryouAct: (id: string, action: string, card?: string) => run(`act ${id} ${action}${card ? ` ${card}` : ''}`),
      foryouReply: (id: string, text: string) => run(`reply ${id} ${text}`),
      foryouMore: async (id: string) => (srv.calls.push(`more ${id}`), { text: 'Vite serves modules as they are asked for.' }),
    },
  }
})

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { ForYouPage, ForYouItemView, MediaPage, mediaFit, waveOf } = await import('./foryou')
const { resetVoice } = await import('./foryou-voice')
const { resetForYou } = await import('./foryou-store')
const { Ctx, setSettledNow } = await import('./app-context')
const { tr, setLang } = await import('../i18n')
const { default: M } = await import('../i18n/foryou')

const NOW = Date.now()
const base = { tone: 'neutral' as const, at: NOW - 5 * 60_000 }
const ITEMS: ForYouItem[] = [
  { ...base, id: 'al', kind: 'alert', tone: 'alert', who: 'weevils', text: 'the usage window is at 92 %', open: { page: 'usage' }, live: true },
  {
    ...base,
    id: 'me',
    kind: 'media',
    tone: 'result',
    who: 'session',
    projectId: 'myshop',
    sessionId: 's9',
    title: 'the new title screen',
    text: 'the new title screen',
    reply: 'session',
    media: [
      { id: 'm1', type: 'image', url: '/api/foryou/media/m1', name: 'title.png', bytes: 1 },
      { id: 'm2', type: 'video', url: '/api/foryou/media/m2', name: 'run.mp4', bytes: 2 },
    ],
  },
  { ...base, id: 'bo', kind: 'boss', who: 'weevboss', text: 'Three sessions sent this morning, two are back.', reply: 'boss', actions: [{ id: 'go', label: 'review the two' }], open: { page: 'boss' } },
  { ...base, id: 'ma', kind: 'mail', who: 'juno', title: 'Re: invoices', text: 'sent the March invoices', body: 'Hello,\nall the March invoices went out this morning.', reply: 'mail', seen: true },
  {
    ...base,
    id: 'pr',
    kind: 'proposals',
    who: 'weevils',
    text: '',
    live: true,
    cards: [
      { id: 'c1', title: 'Harden the tests', why: 'three flaky runs this week', source: 'optimizer', kind: 'tests' },
      { id: 'c2', title: 'Watch the fairs', why: '', source: 'tip', kind: 'watch' },
      { id: 'c3', title: 'Draft the page', why: '', source: 'boss', kind: 'content' },
    ],
  },
  { ...base, id: 'se', kind: 'session', tone: 'question', who: 'session', projectId: 'myshop', sessionId: 's1', title: 'fix the login', text: 'Should I keep the old cookie?', reply: 'session', actions: [{ id: 'resume', label: 'resume' }] },
  { ...base, id: 'im', kind: 'improve', tone: 'magic', who: 'weevils', title: 'Your evenings', text: 'Most of your sessions start after 9 pm: queue them for the night.', actions: [{ id: 'do', label: 'do it' }], reply: 'boss' },
  { ...base, id: 'in', kind: 'insight', who: 'weevils', projectId: 'myshop', text: 'Vite only bundles for production.', more: true },
  { ...base, id: 'mi', kind: 'milestone', who: 'weevils', title: 'turns delivered today', text: '42 turns delivered today, up from 30 yesterday' },
  { ...base, id: 'st', kind: 'stat', who: 'weevils', title: 'this week', text: '', gauges: [{ label: 'usage', value: 71, max: 100, shown: '71 %', hot: true }, { label: 'myshop', value: 12, max: 18, shown: '12 of 18', projectId: 'myshop' }] },
]
const feed = (items: ForYouItem[], rev = 1): ForYouFeed => ({ rev, items, pulse: { working: 2, waiting: 1, delivered: 7, auto: 3 } })

/** rev null: a server without the stream (older, or a secondary machine). */
const snap = (rev: number | null = 1): Snapshot => ({
  version: rev ?? 1,
  now: NOW,
  machines: [{ id: 'm', name: 'm' }],
  projects: [{ id: 'myshop', name: 'myshop', kind: 'repo', repos: ['myshop'], where: {}, lastActivityAt: 0 }],
  sessions: [],
  h24: [],
  conversations: [],
  conversationCounts: { total: 0, pending: 0, byProject: {} },
  classifier: { running: false, queued: 0 },
  main: [],
  mainWorking: false,
  mainHasScreen: false,
  mainQueued: 0,
  devil: { enabled: false, working: false },
  pinnedRepos: [],
  config: { userName: '', exposeDomain: '', publicHost: 'app.example', authors: [{ id: 'juno', name: 'Juno', color: '#2ec4b6' }] },
  foryou: rev === null ? undefined : { rev, unseen: 3 },
})

let root: Root
let host: HTMLElement
let pushed: unknown[]

function render(node: React.ReactNode, s = snap()) {
  const ctx = {
    snap: s,
    now: NOW,
    offline: false,
    colors: { myshop: 'p4' },
    push: (p: unknown) => pushed.push(p),
    replace: () => {},
    back: () => pushed.push('back'),
    home: () => pushed.push('home'),
    expanded: null,
    setExpanded: () => {},
    h24Open: false,
    setH24Open: (_open: boolean, id?: string) => pushed.push({ kind: 'auto', id }),
    theme: 'light' as const,
    setTheme: () => {},
    refresh: () => {},
    logout: () => {},
  }
  act(() => root.render(<Ctx.Provider value={ctx}>{node}</Ctx.Provider>))
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 30)))
const click = (el: Element | null | undefined) => act(async () => void (el as HTMLElement).click())
const band = (id: string) => host.querySelector<HTMLElement>(`[data-fy="${id}"]`)!
const labelled = (label: string, within: ParentNode = host) => [...within.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === label)
const t = () => tr(M)

async function open(items = ITEMS, who?: string) {
  srv.feed = feed(items)
  render(<ForYouPage who={who} />)
  await flush()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  receipts.rows = []
  srv.gate = null
  resetForYou()
  resetVoice()
  setSettledNow(true)
  srv.calls.length = 0
  srv.fail = ''
  srv.result = {}
  pushed = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

it.each(['', 'https://app.example'])('opens a result page directly from local or public links: %s', async (origin) => {
  const item: ForYouItem = { ...base, id: 'page-result', kind: 'boss', who: 'session', text: 'The report is ready to review.', body: `Read [Requests and goals](${origin}/p/report/requests).`, open: { page: 'boss' } }
  await open([item])
  const link = band(item.id).querySelector('a.living')!
  expect(link.textContent).toBe('Requests and goals')
  expect(link.closest('button')).toBeNull()
  await click(link)
  expect(pushed.at(-1)).toEqual({ kind: 'webpage', path: '/p/report/requests', title: 'Requests and goals', pageKind: 'report' })
  expect(srv.calls.some((c) => c.startsWith('act ') || c.startsWith('reply '))).toBe(false)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('for you page', () => {

  it('an empty stream is one quiet line', async () => {
    await open([])
    expect(host.querySelectorAll('[data-fy]')).toHaveLength(0)
    expect(host.querySelector('.fy-end')!.textContent).toBe(t().empty)
  })

  it('newcomers that arrived under the finger wait behind « n new »; a tap brings them in', async () => {
    await open(ITEMS.slice(2, 4))
    setSettledNow(false)
    srv.feed = feed([ITEMS[0], ...ITEMS.slice(2, 4)], 2)
    render(<ForYouPage />, snap(2))
    await flush()
    expect([...host.querySelectorAll('[data-fy]')].map((e) => e.getAttribute('data-fy'))).toEqual(['bo', 'ma'])
    const strip = host.querySelector<HTMLElement>('.fy-fresh')!
    expect(strip.textContent).toContain(t().fresh(1))
    await click(strip)
    await flush()
    expect([...host.querySelectorAll('[data-fy]')].map((e) => e.getAttribute('data-fy'))).toEqual(['al', 'bo', 'ma'])
    expect(host.querySelector('.fy-fresh')).toBeNull()
  })

  it('without a stream on the server: an empty page, and no call', async () => {
    render(<ForYouPage />, snap(null))
    await flush()
    expect(srv.calls).toEqual([])
    expect(host.querySelector('.page')).toBeTruthy()
    expect(host.querySelectorAll('[data-fy]')).toHaveLength(0)
  })
})

describe('for you: voice bars', () => {
  it('the bars of an item are always the same, between a quarter and full height', () => {
    expect(waveOf('b:1', 26)).toEqual(waveOf('b:1', 26))
    expect(waveOf('b:1', 26)).not.toEqual(waveOf('b:2', 26))
    for (const h of waveOf('b:1', 26)) expect(h >= 0.25 && h <= 1).toBe(true)
  })
})

describe('for you: figures, the line, media fit', () => {

  it('no status readout above the stream: it is content, not a control panel', async () => {
    await open()
    expect(host.querySelector('.fy-pulse')).toBeNull()
  })

  it('a media is never cut by more than a little: beyond, it is shown whole', () => {
    // One media alone on a phone (390 wide, cap 523): landscape and near-square fill, a portrait clip is shown whole.
    expect(mediaFit(1280, 720, 390, 523, false)).toBe('cover')
    expect(mediaFit(1170, 1560, 390, 523, false)).toBe('cover')
    expect(mediaFit(1000, 1480, 390, 523, false)).toBe('cover') // 577 high: 9 % over the cap
    expect(mediaFit(720, 1280, 390, 523, false)).toBe('contain')
    // Wide screen, in the 760 column (cap 496): the portrait clip would lose two thirds.
    expect(mediaFit(720, 1280, 760, 496, false)).toBe('contain')
    expect(mediaFit(1280, 720, 760, 496, false)).toBe('cover')
    // Several side by side: the box is fixed, so both ways count.
    expect(mediaFit(1280, 720, 335, 374, true)).toBe('contain')
    expect(mediaFit(1000, 1100, 335, 374, true)).toBe('cover')
    // Not known yet.
    expect(mediaFit(0, 0, 390, 523, false)).toBe('cover')
  })
})

describe('for you: strips and the media viewer', () => {

  it('the viewer shows the image whole, or the video with its controls, and goes back', async () => {
    render(<MediaPage url="/api/foryou/media/m1" type="image" name="title.png" />)
    expect(host.querySelector('.fy-stage img')!.getAttribute('src')).toBe('/api/foryou/media/m1')
    expect(host.querySelector('.fy-stage img')!.getAttribute('alt')).toBe('title.png')
    // The raw file name is not printed in the header (it stays the dialog's accessible name).
    expect(host.querySelector('.fy-viewer-top')!.textContent).not.toContain('title.png')
    await click(labelled(t().back))
    expect(pushed).toEqual(['back'])
    render(<MediaPage url="/api/foryou/media/m2" type="video" name="run.mp4" />)
    const video = host.querySelector<HTMLVideoElement>('.fy-stage video')!
    expect(video.controls).toBe(true)
    expect(video.getAttribute('src')).toBe('/api/foryou/media/m2')
  })

  it('in the viewer, a long press on the photo opens the share sheet with the original file', async () => {
    const nav = navigator as unknown as Record<string, unknown>
    const files: File[] = []
    nav.share = vi.fn(async (d: { files: File[] }) => void files.push(...d.files))
    nav.canShare = vi.fn(() => true)
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })) as typeof fetch
    vi.useFakeTimers()
    try {
      render(<MediaPage url="/api/foryou/media/m77" type="image" name="title.png" />)
      const img = host.querySelector<HTMLImageElement>('.fy-stage img')!
      await act(async () => { img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 5, clientY: 5 })) })
      await act(async () => { vi.advanceTimersByTime(600) })
      await act(async () => { img.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })) })
      await act(async () => { await vi.runAllTimersAsync() })
      expect(files).toHaveLength(1)
      expect(files[0]).toMatchObject({ name: 'title.png', type: 'image/png', size: 3 })
    } finally {
      vi.useRealTimers()
      globalThis.fetch = realFetch
      delete nav.share
      delete nav.canShare
    }
  })
})

it('keeps authored panel text accessible when every source image is missing',async()=>{
 setLang('en')
 await open([{...ITEMS.find(i=>i.id==='me')!,media:[],composition:{layout:'split',panels:[{mediaId:'gone',title:'Earlier view',text:'The original context remains available.'}]}}])
 expect(band('me').textContent).toContain('The original context remains available.')
 expect(band('me').querySelector('[role="status"]')?.textContent).toContain('did not load')
 expect(band('me').querySelector('img')).toBeNull()
})

it('uses the static recursive signature only for structured identity, including compact history', () => {
 const item:ForYouItem={...ITEMS.find(i=>i.id==='bo')!,seen:true,workstream:{kind:'self-improvement',installationId:'here',target:{machineId:'vps',projectId:'weevils',repo:'weevils'},evidence:'repository-identity'}}
 for(const compact of [false,true]) {
  render(<ForYouItemView item={item} compact={compact}/> )
  expect(band(item.id).classList.contains('recursive-identity')).toBe(true)
  expect(band(item.id).className).not.toMatch(/recursive-working|is-working|fy-drift/)
  expect(band(item.id).getAttribute('data-fy')).toBe(item.id)
  render(<ForYouItemView item={{...item,workstream:undefined,text:'weevils improves itself every night now',projectId:'weevils'}} compact={compact}/> )
  expect(band(item.id).classList.contains('recursive-identity')).toBe(false)
 }
 expect(srv.calls.some(c=>/^(act|reply|dismiss) /.test(c))).toBe(false)
})

describe('for you: a feed of posts', () => {
  it('one single stream titled only « For you »: no chips, no kind words; each post says who, then its bold title on top', async () => {
    setLang('en')
    await open()
    expect(host.querySelector('.fy-people')).toBeNull()
    expect([...host.querySelectorAll('.fy-words .word')].map((w) => w.textContent)).toEqual(['For you'])
    const body = host.querySelector('[data-scroll]')!
    expect(body.querySelector('.fy-who, .fy-dot, .fy-plus, .fy-bang, .fy-btn, .fy-gauges, .fy-reply, details, .fy-num')).toBeNull()
    const text = body.textContent!
    for (const word of ['Action', 'Progress', 'Learn', 'Think', 'Visual', 'proposals', 'insight', 'Harden the tests', 'Your evenings', 'Vite only bundles', '42']) expect(text).not.toContain(word)
    for (const post of body.querySelectorAll('.fy-post')) {
      const head = post.querySelector('.fy-post-head')!
      expect(head.firstElementChild!.className).toBe('fy-src')
      expect(head.children[1].className).toMatch(/fy-post-t/)
    }
    expect(band('se').querySelector('.fy-src')!.textContent).toContain('myshop')
    expect(band('ma').querySelector('.fy-src')!.textContent).toContain('Juno')
  })

  it('every post takes one format; proposals, ideas, trivia and figures stay out', async () => {
    await open()
    const formats = Object.fromEntries([...host.querySelectorAll('[data-fy]')].map((e) => [e.getAttribute('data-fy'), e.getAttribute('data-fy-format')]))
    expect(formats).toEqual({ al: 'action', me: 'visual', bo: 'note', ma: 'note', se: 'action' })
  })

  it('the media sits inside its post, under the title, never as a caption below', async () => {
    await open([ITEMS.find((i) => i.id === 'me')!])
    const post = band('me')
    const kids = [...post.children].map((e) => e.className)
    expect(kids.findIndex((c) => /fy-post-head/.test(c))).toBeLessThan(kids.findIndex((c) => /fy-post-media/.test(c)))
    expect(post.querySelector('.fy-caption')).toBeNull()
    expect(post.querySelector('.fy-post-t')!.textContent).toBe('the new title screen')
  })

  it('an alert is calm: a look, never the alert colour or an inverted band', async () => {
    setLang('en')
    await open([ITEMS[0]])
    expect(band('al').className).not.toMatch(/invert|fy-t-alert/)
    expect(band('al').getAttribute('style')).not.toContain('--alert')
    await click(band('al').querySelector('.fy-post-head'))
    await click(host.querySelector('.fy-sheet-go'))
    expect(pushed.length + srv.calls.length).toBeGreaterThan(0)
  })

  it('a post has nothing to tap inside; tapped, its sheet says the next step in words and takes a word to weevboss', async () => {
    setLang('en')
    await open([ITEMS.find((i) => i.id === 'bo')!])
    expect(band('bo').querySelector('.fy-tap, .fy-taps')).toBeNull()
    await click(band('bo').querySelector('.fy-post-head'))
    const sheet = host.querySelector<HTMLElement>('.fy-sheet[role="dialog"]')!
    expect(sheet.querySelector('.fy-sheet-t')!.textContent).toContain('Three sessions sent this morning')
    expect([...sheet.querySelectorAll('.fy-sheet-go')].map((b) => b.textContent)).toEqual(['review the two'])
    const input = sheet.querySelector<HTMLInputElement>('input')!
    expect(input.placeholder).toBe(t().sheetWrite)
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'merge the second one')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => void sheet.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    expect(srv.calls).toContain('reply bo merge the second one')
  })

  it('a post without a choice offers where it comes from, in words', async () => {
    setLang('en')
    await open([ITEMS.find((i) => i.id === 'me')!])
    await click(band('me').querySelector('.fy-post-head'))
    expect([...host.querySelectorAll('.fy-sheet-go')].map((b) => b.textContent)).toEqual([t().openConversation])
  })

  it('« Look » on an automation’s post opens that automation’s page, never a drawer the host may not have', async () => {
    setLang('en')
    const post = { ...base, id: 'post-a1', kind: 'boss' as const, who: 'weevboss', text: 'Ad maker: 38 runs, 9 of the last 10 good.', open: { page: 'auto' as const, id: 'a1' } }
    srv.feed = feed([post])
    render(<ForYouPage />, { ...snap(), optimizers: [{ id: 'a1', title: 'Ad maker', why: '', repo: null, kind: 'other', heavy: false, state: 'queued', createdAt: NOW }] })
    await flush()
    await click(band('post-a1').querySelector('.fy-post-head'))
    expect([...host.querySelectorAll('.fy-sheet-go')].map((b) => b.textContent)).toEqual([t().tapLook])
    await click(host.querySelector('.fy-sheet-go'))
    expect(pushed).toEqual([{ kind: 'auto', id: 'a1' }])
  })

  // A post's step never leads nowhere: every destination does something that can be seen.
  it.each<[string, ForYouItem['open'], unknown[]]>([
    ['a session', { page: 'session', id: 's1' }, [{ kind: 'session', id: 's1' }]],
    ['weevboss’s thread', { page: 'boss', mid: 'm9' }, [{ boss: { mid: 'm9', flash: true } }]],
    ['an automation that is gone: the list of automations', { page: 'auto', id: 'deleted' }, ['home', { kind: 'auto', id: undefined }]],
    ['the automations', { page: 'auto' }, ['home', { kind: 'auto', id: undefined }]],
    ['the usage page', { page: 'usage' }, [{ kind: 'usage' }]],
    ['the machine', { page: 'machine' }, [{ kind: 'machine', projectId: 'myshop' }]],
  ])('the step of a post about %s does something', async (_name, target, seen) => {
    setLang('en')
    const onBoss = (e: Event) => void pushed.push({ boss: (e as CustomEvent).detail })
    window.addEventListener('weevils:focus-boss', onBoss)
    try {
      await open([{ ...base, id: 'p1', kind: 'boss', who: 'weevboss', projectId: 'myshop', text: 'Something to look at.', open: target }])
      await click(band('p1').querySelector('.fy-post-head'))
      expect(host.querySelectorAll('.fy-sheet-go')).toHaveLength(1)
      await click(host.querySelector('.fy-sheet-go'))
      expect(pushed).toEqual(seen)
    } finally {
      window.removeEventListener('weevils:focus-boss', onBoss)
    }
  })

  it('a destination this app cannot reach draws no button: the sheet keeps its field, nothing is dead', async () => {
    setLang('en')
    await open([{ ...base, id: 'p1', kind: 'boss', who: 'weevboss', text: 'From a newer server.', open: { page: 'hologram' } as unknown as ForYouItem['open'] }])
    await click(band('p1').querySelector('.fy-post-head'))
    expect(host.querySelector('.fy-sheet[role="dialog"]')).not.toBeNull()
    expect(host.querySelectorAll('.fy-sheet-go')).toHaveLength(0)
    expect(host.querySelector('.fy-sheet input')).not.toBeNull()
  })

  it('posts touch; two neighbours in one colour never look like one', async () => {
    const { altsOf } = await import('./foryou')
    const c = (id: string) => ({ ...base, id, kind: 'boss' as const, who: 'weevboss', text: id })
    const colour: Record<string, string> = { a: 'x', b: 'x', c: 'x', d: 'y', e: 'y' }
    expect(altsOf(['a', 'b', 'c', 'd', 'e'].map(c), (i) => colour[i.id])).toEqual([false, true, false, false, true])
  })

  it('a long title is cut to a short line, never on « … »', async () => {
    const long = { ...base, id: 'b:long', kind: 'boss' as const, who: 'weevboss', text: 'Vite only bundles for production and ' + 'serves each module on demand during development '.repeat(8) }
    await open([long])
    const line = band('b:long').querySelector('.fy-post-t')!.textContent!
    expect(line.length).toBeLessThanOrEqual(90)
    expect(line.endsWith('…')).toBe(false)
  })

  it('the page renders at most 60 items', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...base, id: `t${i}`, kind: 'boss' as const, who: 'weevboss', text: `Thought number ${i} worth a second look today.`, actions: [{ id: 'go', label: 'Go' }] }))
    await open(many)
    expect(host.querySelectorAll('[data-fy]').length).toBe(60)
  })
})
