// @vitest-environment happy-dom
// Envoyer à weevboss (clavier, logo vocal, pièce jointe) n'ouvre jamais le plein écran : tout reste réduit,
// le message et la réponse s'affichent dans l'aperçu. Régressé deux fois : ce test le garde.
import { act } from 'react'
import { MotionGlobalConfig } from 'motion/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, Snapshot } from '../../shared/api.ts'

const sent = vi.hoisted(() => ({ main: [] as string[], devil: [] as string[], attach: [] as string[], gate: null as Promise<void> | null, fail: '' }))

vi.mock('../api', () => ({
  api: {
    main: async (text: string) => {
      sent.main.push(text)
      if (sent.gate) await sent.gate
      if (sent.fail) throw new Error(sent.fail)
    },
    devil: async (text: string) => void sent.devil.push(text),
    mainAttach: async (text: string, files: { name: string }[]) => void sent.attach.push(`${text}|${files.map((f) => f.name).join(',')}`),
    usageRate: async () => ({ step: 15_000, end: Date.now(), buckets: [] }),
  },
}))
vi.mock('../push', () => ({ ensurePush: async () => {} }))
// Le logo vocal : on ne simule pas le micro, seulement ce qu'il fait au bout du compte (texte entendu, puis envoi).
vi.mock('./voice', () => ({
  VoiceLogo: ({ onText, onSend }: { onText: (t: string) => void; onSend: () => void }) => (
    <button
      data-testid="logo"
      onClick={() => {
        onText('dicté au logo')
        setTimeout(onSend, 0)
      }}
    />
  ),
}))

const { AgentBand } = await import('./bands')
const { Ctx } = await import('./app-context')
const { setDevil } = await import('./devil')
const { tr } = await import('../i18n')
const { default: BM } = await import('../i18n/bands')

const msg = (id: string, role: Message['role'], text: string, at: number): Message => ({ id, role, text, at })

const snap = (main: Message[], working = false): Snapshot => ({
  version: 1,
  now: Date.now(),
  machines: [],
  projects: [],
  sessions: [],
  h24: [],
  conversations: [],
  conversationCounts: { total: 0, pending: 0, byProject: {} },
  classifier: { running: false, queued: 0 },
  main,
  mainWorking: working,
  mainHasScreen: false,
  mainQueued: 0,
  devil: { enabled: false, working: false },
  pinnedRepos: [],
  config: { userName: '', exposeDomain: '', publicHost: '' },
})

let root: Root
let host: HTMLElement
let expanded: (string | null)[]

function render(s: Snapshot, open = false) {
  const ctx = {
    snap: s,
    now: Date.now(),
    offline: false,
    colors: {},
    push: () => {},
    replace: () => {},
    back: () => {},
    home: () => {},
    expanded: open ? 'agent' : null,
    setExpanded: (id: string | null) => void expanded.push(id),
    h24Open: false,
    setH24Open: () => {},
    theme: 'light' as const,
    setTheme: () => {},
    refresh: () => {},
    logout: () => {},
  }
  act(() =>
    root.render(
      <Ctx.Provider value={ctx}>
        <AgentBand />
      </Ctx.Provider>,
    ),
  )
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 20)))

const type = async (text: string) => {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>('form input:not([type=file]), form textarea')!
  await act(async () => {
    const proto = Object.getPrototypeOf(field)
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submit = () => act(async () => void host.querySelector('form')!.requestSubmit())

// Des bulles apparaissent et partent (envoi en cours, réponse) : sans Web Animations, motion les joue en JS (happy-dom
// rejette celles qu'on annule).
const animate = Element.prototype.animate
beforeAll(() => void ((Element.prototype as { animate?: unknown }).animate = undefined))
afterAll(() => void (Element.prototype.animate = animate))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  sent.main = []
  sent.devil = []
  sent.attach = []
  sent.gate = null
  sent.fail = ''
  expanded = []
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('bande de weevboss : envoyer ne l’ouvre jamais en plein écran', () => {
  it('au clavier', async () => {
    render(snap([msg('a', 'assistant', 'salut', 1)]))
    await type('fais le point')
    await submit()
    await flush()
    expect(sent.main).toEqual(['fais le point'])
    expect(expanded).not.toContain('agent')
  })

  it('au logo vocal', async () => {
    render(snap([]))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid=logo]')!.click())
    await flush()
    expect(sent.main).toEqual(['dicté au logo'])
    expect(expanded).not.toContain('agent')
  })

  it('avec une pièce jointe', async () => {
    render(snap([]))
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!
    const file = new File(['%PDF-1.4'], 'devis.pdf', { type: 'application/pdf' })
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    await type('regarde ça')
    await submit()
    await flush()
    expect(sent.attach).toEqual(['regarde ça|devis.pdf'])
    expect(expanded).not.toContain('agent')
  })

  it('en devil mode', async () => {
    localStorage.setItem('weevils-devil', '1')
    render({ ...snap([]), devil: { enabled: true, working: false } })
    await type('dis un truc')
    await submit()
    await flush()
    expect(sent.devil).toEqual(['dis un truc'])
    expect(expanded).not.toContain('agent')
  })

  it('devil mode resté allumé sur l’appareil, mais plus de modèle branché : weevboss reçoit', async () => {
    localStorage.setItem('weevils-devil', '1')
    render(snap([]))
    expect(host.querySelector('.devil-on')).toBeNull()
    await type('dis un truc')
    await submit()
    await flush()
    expect(sent.main).toEqual(['dis un truc'])
    expect(sent.devil).toEqual([])
  })

  it('le réglage du devil mode s’applique tout de suite à la bande', async () => {
    render({ ...snap([]), devil: { enabled: true, working: false } })
    expect(host.querySelector('.devil-on')).toBeNull()
    act(() => setDevil(true))
    expect(host.querySelector('.devil-on')).not.toBeNull()
    act(() => setDevil(false))
    expect(host.querySelector('.devil-on')).toBeNull()
  })

  it('le message envoyé et la réponse apparaissent dans l’aperçu, bande réduite', async () => {
    render(snap([msg('u', 'user', 'fais le point', 1), msg('r', 'assistant', 'Tout tourne, deux sessions travaillent.', 2)]))
    const peek = host.querySelector('.peek')!
    expect(peek.textContent).toContain('fais le point')
    expect(peek.textContent).toContain('Tout tourne, deux sessions travaillent.')
    // Le fil est déjà rendu mais caché : l'ouvrir est immédiat.
    expect(host.querySelector<HTMLElement>('#agent-body')!.hidden).toBe(true)
    // Le tap simple, lui, ouvre la conversation.
    await act(async () => (peek as HTMLElement).click())
    expect(expanded).toEqual(['agent'])
  })
})

describe('fil de weevboss ouvert : il suit la réponse qui s’écrit', () => {
  // happy-dom ne calcule pas de mise en page : la hauteur du fil suit la longueur du dernier message.
  const fake = (el: HTMLElement, height: () => number) => {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: height })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 300 })
  }
  const devil = (text: string) => ({ ...msg('d', 'assistant', text, 2), devil: true })

  it('une réponse du diable en direct garde la fin visible', async () => {
    let s = { ...snap([msg('u', 'user', 'et toi ?', 1), devil('')]), devil: { enabled: true, working: true } }
    render(s, true)
    const chat = host.querySelector<HTMLElement>('.chat')!
    let h = 1000
    fake(chat, () => h)
    chat.scrollTop = 700
    for (const text of ['Moi', 'Moi je pense', 'Moi je pense que non, et voici pourquoi.']) {
      h += 200
      s = { ...s, main: [s.main[0], devil(text)] }
      render(s, true)
      expect(chat.scrollTop).toBe(h)
    }
  })

  it('notre propre défilement doux ne décroche pas le suivi (aperçu réduit)', async () => {
    let s = snap([msg('u', 'user', 'fais le point', 1)])
    render(s)
    const peek = host.querySelector<HTMLElement>('.peek')!
    let h = 800
    fake(peek, () => h)
    // Une position intermédiaire d'un défilement animé, loin du bas, sans geste : ce n'est pas l'utilisateur qui relit.
    peek.scrollTop = 100
    await act(async () => void peek.dispatchEvent(new Event('scroll')))
    h = 1100
    s = { ...s, main: [...s.main, msg('r', 'assistant', 'Tout tourne.', 2)] }
    render(s)
    expect(peek.scrollTop).toBe(1100)
  })

  it('pas quand on relit plus haut', async () => {
    let s = { ...snap([msg('u', 'user', 'et toi ?', 1), devil('')]), devil: { enabled: true, working: true } }
    render(s, true)
    await flush()
    const chat = host.querySelector<HTMLElement>('.chat')!
    fake(chat, () => 3000)
    // Un geste de l'utilisateur (le doigt remonte) : seul un geste décroche le suivi, pas un défilement du programme.
    await act(async () => void chat.dispatchEvent(new Event('touchstart')))
    chat.scrollTop = 200
    await act(async () => void chat.dispatchEvent(new Event('scroll')))
    await act(async () => void chat.dispatchEvent(new Event('touchend')))
    s = { ...s, main: [s.main[0], devil('Moi je pense')] }
    render(s, true)
    expect(chat.scrollTop).toBe(200)
  })
})

describe('le message envoyé se voit tout de suite', () => {
  // Ce qui part de l'aperçu part tout de suite (sans l'animation de sortie) : on lit l'état final.
  beforeAll(() => void (MotionGlobalConfig.skipAnimations = true))
  afterAll(() => void (MotionGlobalConfig.skipAnimations = false))
  it('une bulle « envoi… » dans l’aperçu dès le tap, remplacée par la vraie à son arrivée', async () => {
    let open = () => {}
    sent.gate = new Promise((r) => (open = r))
    const s = snap([msg('a', 'assistant', 'salut', 1)])
    render(s)
    await type('fais le point')
    await submit()
    const peek = host.querySelector('.peek')!
    expect(peek.textContent).toContain('fais le point')
    expect(peek.textContent).toContain(tr(BM).sending)
    // Claude Code l'a écrit dans son transcript : une seule bulle, la vraie.
    render({ ...s, main: [...s.main, msg('u', 'user', 'fais le point', 2)] })
    await act(async () => open())
    await flush()
    expect(peek.textContent).not.toContain(tr(BM).sending)
    expect(peek.textContent!.split('fais le point').length - 1).toBe(1)
  })

  it('un envoi refusé retire la bulle, rend le texte et dit pourquoi', async () => {
    sent.fail = 'weevboss est occupé'
    render(snap([msg('a', 'assistant', 'salut', 1)]))
    await type('fais le point')
    await submit()
    await flush()
    expect(host.querySelector('.peek')!.textContent).not.toContain('fais le point')
    expect(host.querySelector<HTMLInputElement>('form input:not([type=file])')!.value).toBe('fais le point')
    expect(host.querySelector('.attach-line')?.textContent).toContain('weevboss est occupé')
  })

  it('le dernier message de l’aperçu montre sa fin, pas son début coupé', () => {
    const long = `${'début '.repeat(80)}la toute fin de la réponse`
    render(snap([msg('a', 'assistant', long, 1)]))
    const last = host.querySelector('.peek-item.last')!
    expect(last.textContent).toContain('la toute fin de la réponse')
    expect(last.textContent!.length).toBeLessThan(long.length)
  })
})
