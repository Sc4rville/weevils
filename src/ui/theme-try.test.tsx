// @vitest-environment happy-dom
// Trying a theme from a For you post or from « …/#theme=<id> », and going back in one tap (src/ui/theme-try.tsx).
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { Ctx } = await import('./app-context')
const { ThemeTryLayer, ThemeTryLinks, postThemes, postThemesUnknown, isTryLink, staleApp, tried } = await import('./theme-try')
const { ThemeLine } = await import('./prefs')
const { setLang } = await import('../i18n')
type Theme = import('./app-context').Theme

let root: Root
let host: HTMLElement
let theme: Theme
let picked: Theme[]

function App({ children, start }: { children: React.ReactNode; start: Theme }) {
  const [t, setT] = useState<Theme>(start)
  theme = t
  const ctx = { theme: t, setTheme: (n: Theme) => { picked.push(n); setT(n) } } as unknown as React.ContextType<typeof Ctx>
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}
const render = (node: React.ReactNode, start: Theme = 'light') => act(() => root.render(<App start={start}>{node}</App>))
const links = () => [...host.querySelectorAll('a')].map((a) => a.textContent)
const tap = (text: string) => act(async () => void [...host.querySelectorAll<HTMLElement>('a, button')].find((a) => a.textContent?.replace(/\s+/g, ' ').includes(text))!.click())

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('fr')
  localStorage.clear()
  picked = []
  history.replaceState(null, '', '/')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setLang(null)
  staleApp.check = null
  vi.useRealTimers()
})

describe('trying a theme', () => {
  it('remembers the first theme left as the one to go back to, whatever is tried after', () => {
    expect(tried(null, 'light', 'crt', 1)).toEqual({ before: 'light', tried: 'crt', at: 1 })
    expect(tried({ before: 'light', tried: 'crt', at: 1 }, 'crt', 'atlas', 2)).toEqual({ before: 'light', tried: 'atlas', at: 2 })
    // Trying the theme the person had is going back.
    expect(tried({ before: 'light', tried: 'crt', at: 1 }, 'crt', 'light', 3)).toBeNull()
    // A record left behind (the person picked another theme since) is not theirs to go back to.
    expect(tried({ before: 'light', tried: 'crt', at: 1 }, 'zen', 'atlas', 4)).toEqual({ before: 'zen', tried: 'atlas', at: 4 })
  })

  it("reads a post's themes from its list or from a link that only says so, and only those this app knows", () => {
    expect(postThemes({ themes: ['departures', 'not-yet', 'newsprint'] })).toEqual(['departures', 'newsprint'])
    expect(postThemesUnknown({ themes: ['departures', 'not-yet'] })).toBe(true)
    expect(postThemes({ link: { url: 'https://weevils.example.com/#theme=crt,atlas' } })).toEqual(['crt', 'atlas'])
    expect(isTryLink({ link: { url: 'https://weevils.example.com/#theme=crt' } })).toBe(true)
    expect(postThemes({ link: { url: 'https://weevils.example.com/p/library/themes' } })).toEqual([])
    expect(isTryLink({ link: { url: 'https://weevils.example.com/p/library/themes' } })).toBe(false)
    expect(postThemesUnknown({})).toBe(false)
  })

  it('one tap applies the theme, the post then offers the way back, one tap restores the person\'s own', async () => {
    render(<><ThemeTryLinks themes={['departures']} /><ThemeTryLayer /></>)
    expect(links()).toEqual(['Essayer ce thème'])
    await tap('Essayer ce thème')
    expect(theme).toBe('departures')
    expect(host.querySelector('.fy-theme-on')?.textContent).toContain('thème départs')
    // The calm line at the top says the same for a moment.
    expect(host.querySelector('.theme-try-line')?.textContent).toContain('revenir à mon thème')
    await tap('revenir à mon thème')
    expect(theme).toBe('light')
    expect(picked).toEqual(['departures', 'light'])
    expect(links()).toEqual(['Essayer ce thème'])
    expect(host.querySelector('.theme-try-line')).toBeNull()
    expect(localStorage.getItem('weevils-theme-try')).toBeNull()
  })

  it('a post with several themes names each; the theme already worn is said, not offered', async () => {
    render(<ThemeTryLinks themes={['departures', 'newsprint']} />, 'newsprint')
    expect(links()).toEqual(['Essayer départs'])
    expect(host.textContent).toContain('papier journal est ton thème')
    await tap('Essayer départs')
    expect(theme).toBe('departures')
    // The other one is now a theme to try too, and going back still leads to the person's own.
    await tap('Essayer papier journal')
    expect(theme).toBe('newsprint')
    expect(localStorage.getItem('weevils-theme-try')).toBeNull()
  })

  it('the app opened on « #theme=<id> » applies it at once, takes it out of the address and offers the way back', async () => {
    history.replaceState(null, '', '/#theme=woodblock')
    render(<ThemeTryLayer />, 'zen')
    expect(theme).toBe('woodblock')
    expect(location.hash).toBe('')
    expect(host.querySelector('.theme-try-line')?.textContent).toContain('thème estampe')
    await tap('revenir à mon thème')
    expect(theme).toBe('zen')
  })

  it('a theme this page does not know: nothing is applied, the address is kept and the newer build is asked for', () => {
    const check = vi.fn()
    staleApp.check = check
    history.replaceState(null, '', '/#theme=from-tomorrow')
    render(<ThemeTryLayer />, 'zen')
    expect(theme).toBe('zen')
    expect(location.hash).toBe('#theme=from-tomorrow')
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('the calm line leaves by itself; the way back stays on the post and in the settings', async () => {
    vi.useFakeTimers()
    render(<><ThemeTryLinks themes={['crt']} /><ThemeTryLayer /><ThemeLine /></>)
    await act(async () => void host.querySelector<HTMLElement>('a')!.click())
    expect(host.querySelector('.theme-try-line')).not.toBeNull()
    await act(async () => void vi.advanceTimersByTime(13_000))
    expect(host.querySelector('.theme-try-line')).toBeNull()
    expect(host.querySelector('.fy-theme-on a')?.textContent).toBe('revenir à mon thème')
  })
})

describe('the theme line of the settings', () => {
  it('lists every theme by name; a tap on one applies it and the list stays open', async () => {
    const { THEMES } = await import('./app-context')
    render(<ThemeLine />)
    const rows = () => [...host.querySelectorAll('button.row')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim())
    expect(rows()).toEqual(['thèmeclair'])
    await act(async () => void host.querySelector<HTMLElement>('button.row')!.click())
    expect(rows()).toHaveLength(1 + THEMES.length)
    for (const name of ['clair', 'sombre', 'papier carbone', 'tableau noir', 'atlas', 'cathodique', 'terrazzo', 'estampe', 'départs', 'papier journal']) expect(rows().some((r) => r.endsWith(name))).toBe(true)
    expect(host.querySelector('.theme-pick button.row .st:not(:empty)')?.closest('button')?.textContent).toContain('clair')
    expect(host.querySelectorAll('.theme-pick button.row .st:not(:empty)')).toHaveLength(1)
    await tap('estampe')
    expect(theme).toBe('woodblock')
    expect(rows()).toHaveLength(1 + THEMES.length)
    expect(rows()[0]).toBe('thèmeestampe')
    // In English too.
    act(() => setLang('en'))
    expect(rows().some((r) => r.endsWith('newsprint'))).toBe(true)
    expect(rows().some((r) => r.endsWith('carbon copy'))).toBe(true)
  })

  it('while a theme is only being tried, the first line of the list goes back to the person\'s own', async () => {
    render(<><ThemeTryLinks themes={['crt']} /><ThemeLine /></>, 'zen')
    await tap('Essayer ce thème')
    await act(async () => void host.querySelector<HTMLElement>('button.row')!.click())
    await tap('revenir à mon thème (zen)')
    expect(theme).toBe('zen')
    // A theme picked in the list is the person's: nothing to go back to.
    await tap('Essayer ce thème')
    await tap('sombre')
    expect(theme).toBe('dark')
    expect(localStorage.getItem('weevils-theme-try')).toBeNull()
  })
})
