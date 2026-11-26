// The e-mail bridge is deprecated and opt-in (server/mailbridge.ts): an address and a password are not enough, it
// starts only with WEEVILS_MAIL_BRIDGE=on, and says once in the journal how to turn it on.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Never a real IMAP connection: a server that never answers.
vi.mock('./imap.ts', () => ({ Imap: class { connect() { return new Promise(() => {}) } close() {} } }))
const { mailBridgeOn, startMailBridge } = await import('./mailbridge.ts')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-optin-'))
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
const deps = { snapshot: () => ({ projects: [], sessions: [] }), sendMain: async () => ({ id: 'x' }), waitMainReply: async () => null } as unknown as Parameters<typeof startMailBridge>[0]
const MAIL = { WEEVILS_MAIL_ADDRESS: 'alex+weevils@example.com', WEEVILS_MAIL_PASSWORD: 'abcd efgh' }

describe('mail bridge opt-in', () => {
  it('reads on / 1 / true, nothing else', () => {
    for (const v of ['on', '1', 'true', 'ON', ' yes ']) expect(mailBridgeOn({ WEEVILS_MAIL_BRIDGE: v })).toBe(true)
    for (const v of ['', '0', 'off', 'false', undefined]) expect(mailBridgeOn({ WEEVILS_MAIL_BRIDGE: v })).toBe(false)
  })

  it('stays off with an address and a password but no WEEVILS_MAIL_BRIDGE, and says so', () => {
    const lines: string[] = []
    expect(startMailBridge(deps, dir, MAIL, (l) => lines.push(l))).toBeNull()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/off.*WEEVILS_MAIL_BRIDGE=on/)
  })

  it('nothing configured: off, silently', () => {
    const lines: string[] = []
    expect(startMailBridge(deps, dir, { WEEVILS_MAIL_BRIDGE: 'on' }, (l) => lines.push(l))).toBeNull()
    expect(lines).toEqual([])
  })

  it('starts with WEEVILS_MAIL_BRIDGE=on', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const b = startMailBridge(deps, dir, { ...MAIL, WEEVILS_MAIL_BRIDGE: 'on' }, () => {})
    expect(b).not.toBeNull()
    b?.stop()
  })
})
