// @vitest-environment happy-dom
// La langue de l'app reste celle de l'utilisateur : un navigateur en français donne une app en français, même avec un
// ancien choix « en » laissé par la ligne qui changeait de langue d'un seul tap (bande du bas, 2026-11-10) ; et un tap
// égaré sur la ligne « langue » ne la change plus : il ouvre le choix, seule une langue tapée la change.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tour', () => ({ TourLine: () => null }))
vi.mock('./tips', () => ({ TipsLine: () => null }))

Object.defineProperty(navigator, 'languages', { value: ['fr-FR', 'fr'], configurable: true })
Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true })
// L'ancienne clé, telle que l'a laissée le tap égaré.
localStorage.setItem('weevils-lang', 'en')
const posted: unknown[] = []
globalThis.fetch = (async (_u: string, init?: RequestInit) => {
  posted.push(JSON.parse(String(init?.body ?? '{}')))
  return new Response('{}')
}) as typeof fetch

const { getLang, langIsChosen, setLang, syncServer, tr } = await import('../i18n')
const { PrefLines } = await import('./prefs')
const { default: B } = await import('../i18n/bands')
const { default: S } = await import('../i18n/setup')
const { default: H } = await import('../i18n/h24')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let el: HTMLElement
beforeEach(() => {
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  posted.length = 0
})
afterEach(() => {
  act(() => root.unmount())
  el.remove()
})

const rows = () => [...el.querySelectorAll('button.row')] as HTMLButtonElement[]
const tap = (b: HTMLElement) => act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe("la langue de l'utilisateur", () => {
  it("un navigateur en français : l'interface sort en français, jamais en anglais", () => {
    expect(localStorage.getItem('weevils-lang')).toBeNull()
    expect(getLang()).toBe('fr')
    expect(langIsChosen()).toBe(false)
    expect(document.documentElement.lang).toBe('fr')
    // Les textes de la capture du 10 novembre (bande des projets, 24/7, pont e-mail).
    expect(tr(B).nothingRunning).toBe('rien ne tourne')
    expect(tr(H).nothing).not.toMatch(/nothing running/)
    expect(tr(S).chip_mail).toBe('brancher le pont e-mail')
    expect(tr(S).q_mail_gmail).toBe('ton adresse Gmail')
    // weevilsd est prévenu de la langue du navigateur, sans qu'elle passe pour un choix.
    syncServer()
    expect(posted).toEqual([{ lang: 'fr', chosen: false }])
  })

  it('un tap sur la ligne « langue » ouvre le choix sans rien changer', () => {
    act(() => root.render(<PrefLines />))
    expect(rows()[0].textContent).toContain('langue · Français')
    expect(rows()[0].textContent).toContain('comme le navigateur')
    tap(rows()[0])
    expect(getLang()).toBe('fr')
    expect(posted).toEqual([])
    expect(rows().map((r) => r.textContent)).toEqual(['langue · Françaiscomme le navigateur', 'comme le navigateur (Français)', 'English', 'Français'])
    // Un second tap sur la ligne la referme, toujours en français.
    tap(rows()[0])
    expect(rows()).toHaveLength(1)
    expect(getLang()).toBe('fr')
  })

  it('seule une langue tapée la change, et weevilsd la reçoit comme un choix ; « comme le navigateur » revient au français', () => {
    act(() => root.render(<PrefLines />))
    tap(rows()[0])
    tap(rows().find((r) => r.textContent === 'English')!)
    expect(getLang()).toBe('en')
    expect(langIsChosen()).toBe(true)
    expect(posted.at(-1)).toEqual({ lang: 'en', chosen: true })
    tap(rows()[0])
    tap(rows().find((r) => r.textContent?.startsWith('same as the browser ('))!)
    expect(getLang()).toBe('fr')
    expect(langIsChosen()).toBe(false)
    expect(posted.at(-1)).toEqual({ lang: 'fr', chosen: false })
    setLang(null)
  })
})
