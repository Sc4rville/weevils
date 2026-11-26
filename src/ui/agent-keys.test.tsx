// @vitest-environment happy-dom
// The agent keys page: the keys in use, a name and « create a key », the new key shown once with « copy », « revoke »
// on a second tap, the agent's address, the connector's address when it is on.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKeyView } from '../../shared/agent-keys.ts'
import type { Snapshot } from '../../shared/api.ts'

const db = vi.hoisted(() => ({ keys: [] as AgentKeyView[], calls: [] as string[], connector: null as string | null }))

vi.mock('../api', () => ({
  api: {
    agentKeys: async () => ({ keys: db.keys.map((k) => ({ ...k })), enabled: true, base: 'https://weevils.example.com', endpoint: 'https://weevils.example.com/agent/v1/messages', connector: db.connector }),
    createAgentKey: async (name: string) => {
      db.calls.push(`create ${name}`)
      const k: AgentKeyView = { id: name.toLowerCase(), name, color: '#22c55e', scope: 'boss:messages', createdAt: Date.now() }
      db.keys.push(k)
      return { ...k, key: 'wva_0123abcd_' + 'k'.repeat(32) }
    },
    setupAsk: async () => ({ ok: true }),
    revokeAgentKey: async (id: string) => {
      db.calls.push(`revoke ${id}`)
      db.keys = db.keys.filter((k) => k.id !== id)
      return { revoked: true }
    },
  },
}))

const { AgentKeysPage } = await import('./agent-keys')
const { Ctx } = await import('./app-context')

let root: Root
let host: HTMLElement

function render() {
  const ctx = {
    snap: { config: { userName: '', exposeDomain: '', publicHost: '' } } as unknown as Snapshot,
    now: Date.now(), offline: false, colors: {}, push: () => {}, replace: () => {}, back: () => {}, home: () => {},
    expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {}, refresh: () => {}, logout: () => {},
  }
  act(() => root.render(<Ctx.Provider value={ctx}><AgentKeysPage /></Ctx.Provider>))
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 30)))
const click = (el: Element | undefined) => act(async () => void (el as HTMLElement).click())
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('weevils-language', 'en')
  db.keys = [{ id: 'scout', name: 'Scout', color: '#3fc1f0', scope: 'boss:messages', createdAt: Date.now() - 86_400_000 }]
  db.calls = []
  db.connector = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('agent keys page', () => {
  it('lists the keys and tells the agent where to write', async () => {
    render()
    await flush()
    expect(host.textContent).toContain('Scout')
    expect(host.textContent).toContain('not used yet')
    // The API stays folded away for developers: no jargon until it is opened.
    expect(host.textContent).not.toContain('Bearer')
    await click(button('For developers'))
    expect(host.textContent).toContain('POST https://weevils.example.com/agent/v1/messages')
    expect(host.textContent).toContain('Authorization: Bearer <key>')
    expect(host.textContent).toContain('Turn on the connector')
  })

  it('shows the connector’s address when it is on', async () => {
    db.connector = 'https://weevils.example.com/mcp'
    render()
    await flush()
    expect(host.textContent).toContain('https://weevils.example.com/mcp')
    expect(host.textContent).toContain('Plug in ChatGPT or Claude.ai')
    expect(host.textContent).toContain('Paste the address and confirm')
  })

  it('says something friendly when there is no key yet', async () => {
    db.keys = []
    render()
    await flush()
    expect(host.textContent).toContain('No agent plugged in yet.')
    expect(host.textContent).toContain('you can remove it whenever you like')
  })

  it('creates a key and shows it once', async () => {
    render()
    await flush()
    const input = host.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Helper')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Create the key'))
    await flush()
    expect(db.calls).toEqual(['create Helper'])
    expect(host.textContent).toContain('wva_0123abcd_')
    expect(host.textContent).toContain('won’t be shown again')
    await click(button('Done'))
    expect(host.textContent).not.toContain('wva_0123abcd_')
  })

  it('revokes on a second tap only', async () => {
    render()
    await flush()
    await click(button('Remove'))
    expect(db.calls).toEqual([])
    expect(host.textContent).toContain('stops working right away')
    await click(button('Yes, remove'))
    await flush()
    expect(db.calls).toEqual(['revoke scout'])
    expect(host.textContent).not.toContain('Scout')
  })
})
