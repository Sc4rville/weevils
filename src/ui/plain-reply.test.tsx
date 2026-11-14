// @vitest-environment happy-dom
// A long agent message in a project session shows one or two plain sentences; the full text waits behind a closed fold.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../../shared/api'
import { Messages } from './bits'
import { setLang } from '../i18n'
import { isLongReply, plainSummary } from './plain-steps'
// The real final report of the « weevils automations » project session (2026-11-14), the user's name taken out.
import REPORT from './fixtures/automations-report.md?raw'
vi.mock('./app-context', () => ({ useApp: () => ({ snap: { config: { authors: [], userName: 'Scarville' }, projects: [], machines: [], sessions: [] }, push: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
const m = (id: string, role: Message['role'], text: string): Message => ({ id, role, text, at: 1 })
beforeEach(() => { setLang('en'); MotionGlobalConfig.skipAnimations = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })

/** What a plain summary never shows: backticks, paths, file names, flags, commit hashes, command names, markdown. */
const TECHNICAL = /`|\/|\.(tsx?|sh|md|json)\b|(^|\s)--?\w|\b[0-9a-f]{7,40}\b|\bweevilsd?\b|\b(git|gh|npm|npx|tmux|ssh|sudo|heavy)\b|\*\*|#/
const sentences = (s: string) => s.match(/[^.!?…]+[.!?…]+/g) ?? []

describe('plain summary of a long agent message', () => {
  it('the automations report: two plain sentences at most, no path, command, id or backtick', () => {
    expect(isLongReply(REPORT)).toBe(true)
    const s = plainSummary(REPORT)!
    expect(s).toBe('I’ve fixed the automation sandbox and added the two guarantees you asked for, and it’s all live on main. The full test suite passes on the merged main.'.replaceAll('’', "'"))
    expect(sentences(s).length).toBeLessThanOrEqual(2)
    expect(s.length).toBeLessThanOrEqual(240)
    expect(s).not.toMatch(TECHNICAL)
  })

  it('short messages stay as they are; lists, code and headings never lead; nothing plain → null', () => {
    expect(isLongReply('Done, the button works again.')).toBe(false)
    expect(isLongReply('a\nb\nc\nd\ne')).toBe(true)
    expect(plainSummary('## Changes\n- `src/a.ts` edited\n\nLe bouton de paiement marche à nouveau sur mobile. J’ai lancé les tests du panier dans `server/cart.test.ts` et ils passent. Reste à décider du libellé.\n\n```sh\nnpm test\n```'))
      .toBe('Le bouton de paiement marche à nouveau sur mobile. Reste à décider du libellé.')
    expect(plainSummary('```\nnpm run build\n```')).toBeNull()
    const long = plainSummary(`${'very '.repeat(80)}long sentence.`)!
    expect(long.length).toBeLessThanOrEqual(240)
    expect(long.endsWith('…')).toBe(true)
  })

  it('real shapes: a dot inside a word never splits, bold numbered blocks never lead, French spacing stays', () => {
    // A version number or a domain used to drop everything before it and start the summary mid-word.
    expect(plainSummary(`Le lot avance bien sur le serveur. Le modèle 4.2 n’a plus de crédits, donc tout passe sur l’autre. Le certificat dépend du service sslip.io pour l’instant, et c’est noté.\n\n${'- détail\n'.repeat(5)}`))
      .toBe('Le lot avance bien sur le serveur. Le modèle 4.2 n’a plus de crédits, donc tout passe sur l’autre.')
    expect(plainSummary('Results of the three commands:\n\n**1) `weevils sessions`**: succeeded, four sessions listed:\n\n**2) `weevils memory`**: not run.\n\nI did not retry either denied command. Approve them in your settings if you want them run.'))
      .toBe('I did not retry either denied command. Approve them in your settings if you want them run.')
    expect(plainSummary(`J’ai corrigé ma consigne précédente : la page n’ajoute plus de bouton à chaque étape. ${'Encore un détail ici. '.repeat(20)}`))
      .toMatch(/^J’ai corrigé ma consigne précédente : la page/)
  })
})

describe('in the project session thread', () => {
  const thread = [m('u', 'user', 'fix the automation sandbox'), m('a', 'assistant', REPORT)]

  it('shows the summary, the full text behind the same closed fold as commands', async () => {
    await act(async () => root.render(<Messages session plain messages={thread} author="claude" />))
    const fold = host.querySelector<HTMLDetailsElement>('details.step-detail.reply-fold')!
    expect(fold).not.toBeNull()
    expect(fold.open).toBe(false)
    const head = fold.querySelector('summary.step-head .text')!.textContent!
    expect(head).toBe(plainSummary(REPORT))
    expect(head).not.toMatch(TECHNICAL)
    // The full report is there, but only inside the closed fold.
    const content = fold.querySelector('.step-content')!
    expect(content.textContent).toContain('deny rules and CLI check')
    expect(content.textContent).toContain('needs the project ids')
    await act(async () => fold.querySelector<HTMLElement>('summary')!.click())
    expect(fold.open).toBe(true)
  })

  it('a short reply is unchanged, and the weevboss thread (not plain) shows the report in full', async () => {
    await act(async () => root.render(<Messages session plain messages={[m('a', 'assistant', 'Done, the button works again.')]} author="claude" />))
    expect(host.querySelector('.reply-fold')).toBeNull()
    expect(host.textContent).toContain('Done, the button works again.')
    await act(async () => root.render(<Messages messages={thread} author="weevboss" />))
    expect(host.querySelector('.reply-fold')).toBeNull()
    expect(host.textContent).toContain('deny rules and CLI check')
  })

  it('French: a message with nothing plain left gets the catalog line', async () => {
    setLang('fr')
    await act(async () => root.render(<Messages session plain messages={[m('a', 'assistant', '```\n' + 'npm run build\n'.repeat(8) + '```')]} author="codex" />))
    expect(host.querySelector('.reply-fold summary')!.textContent).toBe('Un message détaillé de l’agent')
  })
})

describe('a brief from weevboss in a project session', () => {
  // The real shape of a weevboss brief (2026-11-14): instructions, a file path, flags, then weevils' hidden context block.
  const LOCALE = ' ⟦weevils — Explicit app locale: English (en). Write UI labels, generated session and project titles and For you publications in natural English.⟧'
  const BRIEF = 'URGENT from Scarville (overrides the earlier decision for this one control): a friend of Scarville is stuck in the onboarding right now. Add ONE always-visible Back button on every step after the first, going exactly one step back and keeping everything already typed. Test on a separate copy (see productions/FACTORY.md), then ship to main fast. Report back: live or not (commit), which steps have it. Then run: weevils show <phone screenshot> "a Back button on every step" --demonstrated "<where>" with a --limit for anything not tested on a real iPhone.' + LOCALE
  const brief = (text: string): Message => ({ id: 'b', role: 'orchestrator', author: 'weevboss', text, at: 1 })

  it('a long brief: one or two plain sentences, the full brief behind the closed fold, never the hidden context block', async () => {
    await act(async () => root.render(<Messages session plain messages={[brief(BRIEF)]} author="claude" />))
    const fold = host.querySelector<HTMLDetailsElement>('details.reply-fold')!
    expect(fold.open).toBe(false)
    const head = fold.querySelector('summary .text')!.textContent!
    expect(head).toBe('URGENT from Scarville: a friend of Scarville is stuck in the onboarding right now. Add ONE always-visible Back button on every step after the first, going exactly one step back and keeping everything already typed.')
    expect(head).not.toMatch(TECHNICAL)
    expect(fold.querySelector('.step-content')!.textContent).toContain('--demonstrated')
    expect(host.textContent).not.toContain('⟦')
    expect(host.textContent).not.toContain('Explicit app locale')
  })

  it('a short brief stays whole, still without the context block; the weevboss thread is not folded', async () => {
    await act(async () => root.render(<Messages session plain messages={[brief(`Go ahead, fix the menu.${LOCALE}`)]} author="claude" />))
    expect(host.querySelector('.reply-fold')).toBeNull()
    expect(host.textContent).toContain('Go ahead, fix the menu.')
    expect(host.textContent).not.toContain('⟦')
    await act(async () => root.render(<Messages session messages={[brief(BRIEF)]} author="weevboss" />))
    expect(host.querySelector('.reply-fold')).toBeNull()
    expect(host.textContent).toContain('ONE always-visible Back button')
    expect(host.textContent).not.toContain('⟦')
  })

  it('a long brief with no plain sentence in it says who sent it, not « the agent »', async () => {
    const steps = Array.from({ length: 6 }, (_, i) => `- \`npm run step${i}\``).join('\n')
    await act(async () => root.render(<Messages session plain messages={[brief(steps + LOCALE)]} author="claude" />))
    expect(host.querySelector('details.reply-fold summary .text')!.textContent).toBe('A detailed message from weevboss')
  })
})
