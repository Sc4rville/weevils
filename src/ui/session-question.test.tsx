// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetNotices } from './notice-store'
import type { Session } from '../../shared/api.ts'
const calls = vi.hoisted(() => ({ key: vi.fn(async (_id: string, _key: string) => {}) }))
vi.mock('../api', () => ({ api: calls }))
const { SessionQuestion } = await import('./session-question')
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  resetNotices()
  calls.key.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const session = (tool: 'codex' | 'claude', over: Partial<Session> = {}) => ({ id: 's1', tool, status: 'needs_user', attention: 'Autoriser cette commande ?', choices: [{ id: 'token:0', label: 'autoriser cette commande' }, { id: 'token:1', label: 'refuser' }], ...over }) as Session
it.each(['claude', 'codex'] as const)('%s renders labeled choices, never a keyboard; a tap sends one validated choice', async (tool) => {
  await act(async () => root.render(<SessionQuestion session={session(tool)} onError={() => {}} />))
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button.choice-band')]
  expect(buttons.map((b) => b.textContent)).toEqual(['autoriser cette commande', 'refuser'])
  expect(host.querySelector('.keys, .key, pre')).toBeNull()
  await act(async () => buttons[1].click())
  await act(async () => buttons[1].click())
  expect(calls.key.mock.calls).toEqual([['s1', 'choice:token:1']])
})
it('working sessions and ordinary composers never produce an attention band', async () => {
  for (const s of [session('codex', { status: 'working' }), session('claude', { attention: '› nn go' }), session('codex', { attention: '› Ask Codex to do anything' })]) {
    await act(async () => root.render(<SessionQuestion session={s} onError={() => {}} />))
    expect(host.textContent).toBe('')
  }
})

it('closing a session question neither answers it nor closes the session; only a new request notifies again', async () => {
  const s = session('codex', { noticeId: 'request-one' })
  await act(async () => root.render(<SessionQuestion session={s} onError={() => {}} />))
  await act(async () => host.querySelector<HTMLButtonElement>('.notice-close')!.click())
  expect(host.textContent).toBe('')
  expect(s.status).toBe('needs_user')
  expect(calls.key).not.toHaveBeenCalled()
  await act(async () => root.render(<SessionQuestion session={{ ...s, lastActivityAt: Date.now(), attention: 'same question refined' }} onError={() => {}} />))
  expect(host.textContent).toBe('')
  await act(async () => root.render(<SessionQuestion session={{ ...s, noticeId: 'request-two' }} onError={() => {}} />))
  expect(host.querySelector('.ask')).not.toBeNull()
})
