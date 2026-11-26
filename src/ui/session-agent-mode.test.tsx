// @vitest-environment happy-dom
// A session's own permission choice on its page (src/ui/session-agent-mode.tsx): one link in its settings, the other
// way from what it does now; one word in its status line only while it differs from the global choice.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, Snapshot } from '../../shared/api.ts'
import { setLang } from '../i18n'
import { Ctx } from './app-context'
import { nextMode, SessionAgentMark, SessionAgentMode, sessionAsks, sessionDiffers } from './session-agent-mode'

const net = vi.hoisted(() => ({ agentMode: vi.fn(async (_id: string, _mode: string | null) => ({ ok: true, ask: true })), refresh: vi.fn() }))
vi.mock('../api', () => ({ api: { agentMode: net.agentMode } }))

const s = (o: Partial<Session> = {}) => ({ id: 's1', title: 'work', tool: 'claude', status: 'idle', ...o }) as Session
const snap = (ask: boolean) => ({ agents: { ask } }) as Pick<Snapshot, 'agents'>

describe('what a session does', () => {
  it('its own choice, else the global one; always asking where its machine runs as root', () => {
    expect(sessionAsks(s(), snap(false))).toBe(false)
    expect(sessionAsks(s(), snap(true))).toBe(true)
    expect(sessionAsks(s({ agentMode: 'ask' }), snap(false))).toBe(true)
    expect(sessionAsks(s({ agentMode: 'auto' }), snap(true))).toBe(false)
    expect(sessionAsks(s({ agentMode: 'auto', agentLocked: true }), snap(false))).toBe(true)
    // An older weevilsd says nothing: on their own, the default.
    expect(sessionAsks(s(), {})).toBe(false)
  })
  it('differs only with its own choice, not the global one, and never when locked', () => {
    expect(sessionDiffers(s(), snap(true))).toBe(false)
    expect(sessionDiffers(s({ agentMode: 'ask' }), snap(true))).toBe(false)
    expect(sessionDiffers(s({ agentMode: 'ask' }), snap(false))).toBe(true)
    expect(sessionDiffers(s({ agentMode: 'ask', agentLocked: true }), snap(false))).toBe(false)
  })
  it('a tap goes the other way; back to the global choice when the other way is the global one', () => {
    expect(nextMode(s(), snap(false))).toBe('ask')
    expect(nextMode(s(), snap(true))).toBe('auto')
    expect(nextMode(s({ agentMode: 'ask' }), snap(false))).toBeNull()
    expect(nextMode(s({ agentMode: 'auto' }), snap(true))).toBeNull()
  })
})

let root: Root, host: HTMLDivElement
const render = async (node: React.ReactNode, ask = false) =>
  act(async () => root.render(<Ctx.Provider value={{ refresh: net.refresh, snap: { agents: { ask } } } as never}>{node}</Ctx.Provider>))
beforeEach(() => {
  setLang('fr')
  net.agentMode.mockClear()
  net.refresh.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('on the page', () => {
  it('the settings link says the other way, in plain words, and sets it', async () => {
    await render(<SessionAgentMode session={s()} />)
    expect(host.textContent).toBe('Me demander dans cette session')
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(net.agentMode.mock.calls).toEqual([['s1', 'ask']])
    expect(net.refresh).toHaveBeenCalledOnce()
    setLang('en')
    await render(<SessionAgentMode session={s({ agentMode: 'ask' })} />)
    expect(host.textContent).toBe('Autonomous in this session')
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(net.agentMode.mock.calls.at(-1)).toEqual(['s1', null])
  })
  it('nothing where its machine runs as root', async () => {
    await render(<SessionAgentMode session={s({ agentLocked: true })} />)
    expect(host.textContent).toBe('')
  })
  it('the status line word: only while it differs, a tap opens the settings', async () => {
    const open = vi.fn()
    await render(<SessionAgentMark session={s()} onOpen={open} />)
    expect(host.textContent).toBe('')
    await render(<SessionAgentMark session={s({ agentMode: 'ask' })} onOpen={open} />)
    expect(host.textContent).toBe(' · me demande avant d’agir')
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(open).toHaveBeenCalledOnce()
    await render(<SessionAgentMark session={s({ agentMode: 'auto' })} onOpen={open} />, true)
    expect(host.textContent).toBe(' · autonome')
  })
})
