// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { Reaction } from './bits'

it('a reaction is the emoji alone on the corner, read out in words, and pops to its new state', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Reaction emoji="📤" />))
  const r = host.querySelector('.reaction')!
  expect(r.textContent).toBe('📤')
  expect(r.getAttribute('aria-label')).toBe('sent to a session')
  await act(async () => root.render(<Reaction emoji="✅" />))
  expect([...host.querySelectorAll('.reaction')].map((e) => e.textContent)).toContain('✅')
  act(() => root.unmount())
})
