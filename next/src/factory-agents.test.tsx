// @vitest-environment happy-dom
// Your factory > Intelligence > Agents (factory.tsx AgentsBand): how agents work on every machine, two words, the one
// in use underlined; one line under it only while they ask, or why it is locked to asking (root).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentsChoice } from '../../shared/api.ts'

const net = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('./data.ts', () => ({ call: vi.fn(async (...a: unknown[]) => (net.calls.push(a), { ok: true })) }))
localStorage.setItem('weevils-language', 'fr')
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate

const { AgentsBand } = await import('./factory.tsx')

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  net.calls = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const mount = async (agents: AgentsChoice) => act(async () => root.render(<AgentsBand agents={agents} step={1} />))
const words = () => [...host.querySelectorAll<HTMLButtonElement>('[role=radio]')]
const hint = () => host.querySelector('.nx-fx-hint')?.textContent ?? null

it('on their own by default: « Autonome » underlined, no line under it', async () => {
  await mount({ ask: false })
  expect(host.querySelector('.nx-row-title')?.textContent).toBe('Agents')
  expect(words().map((b) => [b.textContent, b.getAttribute('aria-checked')])).toEqual([['Autonome', 'true'], ['Me demander', 'false']])
  expect(words()[0].className).toContain('strong')
  expect(hint()).toBeNull()
})

it('a tap on « Me demander » sets it for every machine, and the one line says what it means', async () => {
  await mount({ ask: false })
  await act(async () => words()[1].click())
  expect(net.calls).toEqual([['POST', '/api/factory/agents', { ask: true }]])
  expect(words()[1].getAttribute('aria-checked')).toBe('true')
  expect(hint()).toBe('Tes agents te demandent avant d’agir : tu réponds depuis l’app.')
  // The choice in use again: nothing sent.
  await act(async () => words()[1].click())
  expect(net.calls).toHaveLength(1)
  await act(async () => words()[0].click())
  expect(net.calls.at(-1)).toEqual(['POST', '/api/factory/agents', { ask: false }])
  expect(hint()).toBeNull()
})

it('as root: locked to « Me demander », with why, and nothing to tap', async () => {
  await mount({ ask: true, locked: 'root' })
  expect(words().every((b) => b.disabled)).toBe(true)
  expect(words()[1].getAttribute('aria-checked')).toBe('true')
  expect(hint()).toBe('weevils tourne en root ici : Claude Code y demande toujours avant d’agir.')
  await act(async () => words()[0].click())
  expect(net.calls).toEqual([])
})
