// @vitest-environment happy-dom
// An automation's brief is the automation's words, never the person's (server/optimizers.ts signs it with its id):
// in its session it reads as any other author's prompt, against the left edge, under the automation's name, in its
// band's colour. Only the person's own words sit on the right.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { expect, it, vi } from 'vitest'
import { TranscriptStore } from '../server/transcripts'
import { signAs } from '../server/authors'
import { Messages } from '../src/ui/bits'
vi.mock('../src/ui/app-context', () => ({ useApp: () => ({ snap: { config: { authors: [] }, projects: [], machines: [], optimizers: [{ id: '811c154e93', title: 'Opportunity hunter' }] }, push: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it("an automation's signed brief shows as the automation's prompt: its name, its colour, not the person's band", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-author-'))
  const claude = path.join(dir, 'claude'), codex = path.join(dir, 'codex'), now = Date.now()
  const f = path.join(claude, 'project', 'cccccccc-3333-4333-8333-333333333333.jsonl')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const brief = 'Look for new leads and write the report.'
  fs.writeFileSync(f, JSON.stringify({ type: 'user', uuid: 'brief', timestamp: new Date(now).toISOString(), message: { role: 'user', content: signAs('811c154e93', brief) } }) + '\n')
  const host = document.createElement('div'); host.className = 'session-thread'; document.body.append(host)
  const root = createRoot(host); MotionGlobalConfig.skipAnimations = true
  try {
    const store = new TranscriptStore(claude, codex, 86400000); store.scan(now)
    const [m] = store.all()[0].messages
    expect(m).toMatchObject({ role: 'orchestrator', author: '811c154e93', text: brief })
    expect(m.coordination).toBeUndefined()
    await act(async () => root.render(<Messages session author="claude" messages={[m]} />))
    const band = host.querySelector<HTMLElement>('.msg.orch')!
    expect(band).not.toBeNull()
    expect(band.closest('details')).toBeNull()
    expect(band.classList.contains('ext')).toBe(true)
    expect(band.style.getPropertyValue('--who')).toMatch(/^var\(--p\d+\)$/)
    expect(band.querySelector('.who')?.textContent).toBe('Opportunity hunter')
    expect(band.textContent).not.toContain('[from:')
  } finally { await act(async () => root.unmount()); host.remove(); MotionGlobalConfig.skipAnimations = false; fs.rmSync(dir, { recursive: true, force: true }) }
})
