// @vitest-environment happy-dom
// The « for you » page: each kind of item shows its essentials, what can be done from the stream calls the right route
// (accept a card, reply, more), a mail unfolds in place, a session's head opens the real conversation.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../../shared/api.ts'
import type { ForYouFeed, ForYouItem } from '../../shared/foryou.ts'

const srv = vi.hoisted(() => ({ feed: null as unknown, calls: [] as string[], fail: '' }))
vi.mock('../api', () => {
  const run = async (what: string) => {
    srv.calls.push(what)
    if (srv.fail && what.startsWith(srv.fail)) throw new Error('refused by the server')
    return { ok: true as const }
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
const { ForYouPage, ForYouItemView, MediaPage } = await import('./foryou')
const { resetForYou } = await import('./foryou-store')
const { Ctx, setSettledNow } = await import('./app-context')
const { FOCUS_BOSS } = await import('./follow')
const { tr } = await import('../i18n')
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
    projectId: 'mygame',
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
  { ...base, id: 'se', kind: 'session', tone: 'question', who: 'session', projectId: 'mygame', sessionId: 's1', title: 'fix the login', text: 'Should I keep the old cookie?', reply: 'session', actions: [{ id: 'resume', label: 'resume' }] },
  { ...base, id: 'im', kind: 'improve', tone: 'magic', who: 'weevils', title: 'Your evenings', text: 'Most of your sessions start after 9 pm: queue them for the night.', actions: [{ id: 'do', label: 'do it' }], reply: 'boss' },
  { ...base, id: 'in', kind: 'insight', who: 'weevils', projectId: 'mygame', text: 'Vite only bundles for production.', more: true },
  { ...base, id: 'mi', kind: 'milestone', who: 'weevils', title: 'turns delivered today', text: '42' },
  { ...base, id: 'st', kind: 'stat', who: 'weevils', title: 'this week', text: '', gauges: [{ label: 'usage', value: 71, max: 100, shown: '71 %', hot: true }, { label: 'mygame', value: 12, max: 18, shown: '12 of 18', projectId: 'mygame' }] },
]
const feed = (items: ForYouItem[], rev = 1): ForYouFeed => ({ rev, items, pulse: { working: 2, waiting: 1, delivered: 7, auto: 3 } })

/** rev null: a server without the stream (older, or a secondary machine). */
const snap = (rev: number | null = 1): Snapshot => ({
  version: rev ?? 1,
  now: NOW,
  machines: [{ id: 'm', name: 'm' }],
  projects: [{ id: 'mygame', name: 'mygame', kind: 'repo', repos: ['mygame'], where: {}, lastActivityAt: 0 }],
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
  config: { userName: '', exposeDomain: '', publicHost: '', authors: [{ id: 'juno', name: 'Juno', color: '#2ec4b6' }] },
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
    colors: { mygame: 'p4' },
    push: (p: unknown) => pushed.push(p),
    replace: () => {},
    back: () => pushed.push('back'),
    home: () => {},
    expanded: null,
    setExpanded: () => {},
    h24Open: false,
    setH24Open: () => {},
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

const type = async (form: HTMLFormElement, text: string) => {
  const field = form.querySelector<HTMLInputElement>('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = (form: HTMLFormElement) => act(async () => void form.requestSubmit())

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  resetForYou()
  setSettledNow(true)
  srv.calls.length = 0
  srv.fail = ''
  pushed = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('for you page', () => {
  it('shows the two words, the line, every item in the server order, then « up to date »', async () => {
    await open()
    expect(host.querySelector('.page[role=dialog]')).toBeTruthy()
    expect(host.querySelector('[data-scroll]')).toBeTruthy()
    expect([...host.querySelectorAll('.fy-words .word')].map((w) => w.textContent)).toEqual(['weevboss', t().title])
    expect(host.querySelector('.fy-words .word.on')!.textContent).toBe(t().title)
    expect([...host.querySelectorAll('[data-fy]')].map((e) => e.getAttribute('data-fy'))).toEqual(ITEMS.map((i) => i.id))
    const pulse = host.querySelector('.fy-pulse')!
    expect(pulse.querySelectorAll('.spin.fluo')).toHaveLength(2)
    expect(pulse.textContent).toContain(t().pulseWorking(2))
    expect(pulse.textContent).toContain(t().pulseDelivered(7))
    expect(pulse.textContent).toContain(t().pulseWaiting(1))
    expect(pulse.textContent).toContain(t().pulseAuto(3))
    expect(host.querySelector('.fy-end')!.textContent).toContain(t().upToDate)
    // The plan's category names are internal: never on screen.
    for (const word of ['proposals', 'insight', 'milestone', 'improve']) expect(host.querySelector('[data-scroll]')!.textContent).not.toContain(word)
  })

  it('each kind shows its essentials', async () => {
    await open()
    // media: the image and the video edge to edge, the video muted, inline, waiting to be in view.
    const media = band('me')
    expect(media.querySelector('img')!.getAttribute('src')).toBe('/api/foryou/media/m1')
    const video = media.querySelector('video')!
    expect(video.getAttribute('src')).toBe('/api/foryou/media/m2')
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')
    expect(media.querySelector('.fy-media-strip.many')).toBeTruthy()
    expect(media.querySelector('.fy-cap.tone')!.textContent).toContain('the new title screen')
    // weevboss: its words, its button, a reply line.
    expect(band('bo').textContent).toContain('Three sessions sent this morning')
    expect(band('bo').querySelector('.fy-btn')!.textContent).toBe('review the two')
    expect(band('bo').querySelector('form.fy-reply')).toBeTruthy()
    // mail: one thin line, author and summary; the body stays folded.
    expect(band('ma').querySelector('.fy-mail')!.textContent).toBe('Junosent the March invoices')
    expect(band('ma').textContent).not.toContain('all the March invoices went out')
    // proposals: « + » leads each title, each card has its ✓ × pair and its own colour.
    const cards = [...band('pr').querySelectorAll<HTMLElement>('.fy-card')]
    expect(cards.map((c) => c.querySelector('.fy-card-t')!.textContent)).toEqual(['Harden the tests', 'Watch the fairs', 'Draft the page'])
    for (const c of cards) {
      expect(c.querySelector('.fy-card-t .fy-plus svg')).toBeTruthy()
      expect(c.querySelector('.fy-ok')).toBeTruthy()
      expect(c.querySelector('.fy-no')).toBeTruthy()
    }
    expect(new Set(cards.map((c) => c.style.getPropertyValue('--c'))).size).toBe(3)
    // session: project · title, what it asks, in the waiting amber, its button and a reply line.
    expect(band('se').querySelector('.fy-head')!.textContent).toBe('mygame · fix the login')
    expect(band('se').textContent).toContain('Should I keep the old cookie?')
    expect(band('se').textContent).toContain(t().toneQuestion)
    expect(band('se').style.getPropertyValue('--c')).toBe('var(--h24)')
    expect(band('se').querySelector('.fy-btn')!.textContent).toBe('resume')
    // improve: the gradient band, « do it », reply, dismiss.
    expect(band('im').classList.contains('fy-k-improve')).toBe(true)
    expect(band('im').querySelector('.fy-btn')!.textContent).toBe('do it')
    expect(band('im').querySelector('form.fy-reply')).toBeTruthy()
    expect(labelled(t().dismiss('Your evenings'), band('im'))).toBeTruthy()
    // alert: one sober inverted line that opens where it is solved.
    expect(band('al').classList.contains('invert')).toBe(true)
    expect(band('al').querySelector('.fy-alert')!.textContent).toBe('the usage window is at 92 %')
    // insight: big type in the project's colour, « more » still folded.
    expect(band('in').querySelector('.fy-big')!.textContent).toBe('Vite only bundles for production.')
    expect(band('in').style.getPropertyValue('--c')).toBe('var(--p4)')
    expect(band('in').querySelector('.fy-more-btn')!.textContent).toBe(t().more)
    // milestone: the number in shifting type.
    expect(band('mi').querySelector('.fy-shift')!.textContent).toBe('42')
    // figures as bars.
    const meters = [...band('st').querySelectorAll('[role=meter]')]
    expect(meters.map((m) => m.getAttribute('aria-valuetext'))).toEqual(['71 %', '12 of 18'])
    expect(meters[0].classList.contains('hot')).toBe(true)
  })

  it('unseen items carry the dot and the heavier type; seen ones do not', async () => {
    await open()
    expect(band('bo').classList.contains('fy-unseen')).toBe(true)
    expect(labelled(t().unseen, band('bo'))).toBeTruthy()
    expect(band('ma').classList.contains('fy-unseen')).toBe(false)
  })

  it('✓ on a card calls the act route with the card, and the card leaves; × refuses', async () => {
    await open()
    await click(labelled(t().accept('Harden the tests')))
    await flush()
    expect(srv.calls).toContain('act pr accept c1')
    expect([...band('pr').querySelectorAll('.fy-card-t')].map((c) => c.textContent)).toEqual(['Watch the fairs', 'Draft the page'])
    await click(labelled(t().refuse('Watch the fairs')))
    await flush()
    expect(srv.calls).toContain('act pr refuse c2')
    // One left: a wide band, still « + » and the pair.
    const last = band('pr').querySelectorAll('.fy-card')
    expect(last).toHaveLength(1)
    expect(last[0].classList.contains('wide')).toBe(true)
    await click(labelled(t().accept('Draft the page')))
    await flush()
    expect(host.querySelector('[data-fy="pr"]')).toBeNull()
  })

  it('a refused action brings the item back and says why', async () => {
    await open()
    srv.fail = 'act'
    await click(band('im').querySelector('.fy-btn'))
    await flush()
    expect(srv.calls).toContain('act im do')
    expect(band('im').querySelector('[role=alert]')!.textContent).toContain('refused by the server')
  })

  it('an action button makes its item leave; dismiss too', async () => {
    await open()
    await click(band('bo').querySelector('.fy-btn'))
    await flush()
    expect(srv.calls).toContain('act bo go')
    expect(host.querySelector('[data-fy="bo"]')).toBeNull()
    await click(labelled(t().dismiss('Your evenings')))
    await flush()
    expect(srv.calls).toContain('dismiss im')
    expect(host.querySelector('[data-fy="im"]')).toBeNull()
  })

  it('a reply goes to the reply route and says « sent » at once; each reply field has its own label', async () => {
    await open()
    const form = band('se').querySelector<HTMLFormElement>('form.fy-reply')!
    await type(form, 'keep it')
    await submit(form)
    await flush()
    expect(srv.calls).toContain('reply se keep it')
    expect(form.querySelector('input')!.value).toBe('')
    expect(form.querySelector('[role=status]')!.textContent).toContain(t().sent)
    const labels = [...host.querySelectorAll('form.fy-reply input')].map((i) => i.getAttribute('aria-label'))
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('a reply the server refuses puts the text back and says why, in place', async () => {
    await open()
    srv.fail = 'reply'
    const form = band('bo').querySelector<HTMLFormElement>('form.fy-reply')!
    await type(form, 'go on')
    await submit(form)
    await flush()
    expect(form.querySelector('input')!.value).toBe('go on')
    expect(form.querySelector('[role=alert]')!.textContent).toContain('refused by the server')
    expect(form.querySelector('[role=status]')!.textContent).toBe('')
  })

  it('a mail unfolds in place: the whole message, and its reply line', async () => {
    await open()
    const line = band('ma').querySelector<HTMLElement>('.fy-mail')!
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(band('ma').querySelector('form.fy-reply')).toBeNull()
    await click(line)
    expect(line.getAttribute('aria-expanded')).toBe('true')
    expect(band('ma').textContent).toContain('all the March invoices went out this morning.')
    expect(band('ma').textContent).toContain('Re: invoices')
    expect(band('ma').querySelector('form.fy-reply')).toBeTruthy()
  })

  it('a session’s head opens the real conversation; a media opens alone; an alert opens where it is solved', async () => {
    await open()
    await click(band('se').querySelector('.fy-head'))
    expect(pushed).toEqual([{ kind: 'session', id: 's1' }])
    await click(labelled(t().openMedia('run.mp4')))
    expect(pushed[1]).toEqual({ kind: 'media', url: '/api/foryou/media/m2', type: 'video', name: 'run.mp4' })
    await click(band('al').querySelector('.fy-alert'))
    expect(pushed[2]).toEqual({ kind: 'usage' })
  })

  it('« more » asks once and unfolds the answer in place', async () => {
    await open()
    const more = band('in').querySelector<HTMLElement>('.fy-more-btn')!
    await click(more)
    await flush()
    expect(srv.calls.filter((c) => c.startsWith('more'))).toEqual(['more in'])
    expect(band('in').textContent).toContain('Vite serves modules as they are asked for.')
    expect(more.textContent).toBe(t().less)
    await click(more)
    await click(more)
    await flush()
    expect(srv.calls.filter((c) => c.startsWith('more'))).toHaveLength(1)
  })

  it('« weevboss » asks for the thread in full, without a flash', async () => {
    await open()
    const seen: unknown[] = []
    const on = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener(FOCUS_BOSS, on)
    await click(host.querySelector('.fy-words button.word'))
    window.removeEventListener(FOCUS_BOSS, on)
    expect(seen).toEqual([{ flash: false }])
  })

  it('the participants line isolates one speaker and remembers it', async () => {
    await open()
    const words = () => [...host.querySelectorAll<HTMLElement>('.fy-people .word')]
    expect(words().map((w) => w.textContent)).toEqual([t().whoAll, 'weevboss', 'Juno', t().whoSessions, t().whoMedia, t().whoIdeas])
    await click(words()[3])
    expect([...host.querySelectorAll('[data-fy]')].map((e) => e.getAttribute('data-fy'))).toEqual(['se'])
    expect(words()[3].getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('weevils-foryou-who')).toBe('session')
    await click(words()[5])
    expect([...host.querySelectorAll('[data-fy]')].map((e) => e.getAttribute('data-fy'))).toEqual(['pr', 'im', 'in', 'mi'])
    // The same word again: everything.
    await click(words()[5])
    expect(host.querySelectorAll('[data-fy]')).toHaveLength(ITEMS.length)
    expect(localStorage.getItem('weevils-foryou-who')).toBe('all')
  })

  it('opens on the participant asked for, else on the one chosen last time', async () => {
    localStorage.setItem('weevils-foryou-who', 'juno')
    await open()
    expect([...host.querySelectorAll('[data-fy]')].map((e) => e.getAttribute('data-fy'))).toEqual(['ma'])
    act(() => root.unmount())
    root = createRoot(host)
    await open(ITEMS, 'weevboss')
    expect([...host.querySelectorAll('[data-fy]')].map((e) => e.getAttribute('data-fy'))).toEqual(['bo'])
  })

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

describe('for you: strips and the media viewer', () => {
  it('compact: a thin strip, speaker and one line, nothing to tap', async () => {
    srv.feed = feed(ITEMS)
    render(
      <>
        <ForYouItemView item={ITEMS[2]} compact />
        <ForYouItemView item={ITEMS[4]} compact />
      </>,
    )
    await flush()
    const strips = [...host.querySelectorAll('.fy-strip')]
    expect(strips.map((s) => s.textContent)).toEqual(['weevbossThree sessions sent this morning, two are back.', 'weevilsHarden the tests'])
    expect(strips[1].querySelector('.fy-plus svg')).toBeTruthy()
    expect(host.querySelectorAll('button, input, form')).toHaveLength(0)
  })

  it('the viewer shows the image whole, or the video with its controls, and goes back', async () => {
    render(<MediaPage url="/api/foryou/media/m1" type="image" name="title.png" />)
    expect(host.querySelector('.fy-stage img')!.getAttribute('src')).toBe('/api/foryou/media/m1')
    expect(host.querySelector('.fy-stage img')!.getAttribute('alt')).toBe('title.png')
    await click(labelled(t().back))
    expect(pushed).toEqual(['back'])
    render(<MediaPage url="/api/foryou/media/m2" type="video" name="run.mp4" />)
    const video = host.querySelector<HTMLVideoElement>('.fy-stage video')!
    expect(video.controls).toBe(true)
    expect(video.getAttribute('src')).toBe('/api/foryou/media/m2')
  })
})
