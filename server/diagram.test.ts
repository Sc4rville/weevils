// weevils diagram (server/diagram.mjs): a backend result drawn as a weevils picture, and `weevils show <flow.mmd>`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS, no types
import { FRESH, INK, KINDS, defaultOut, diagramPage, parseDiagram, rows } from './diagram.mjs'

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const FLOW = `---
title: History now syncs
---
flowchart LR
  phone[Your phone] -->|asks| api[weevilsd<br>on the VPS]
  api ==>|checks first| allow[Allow list]:::lock:::new
  api --> hist[History]
  agent[Claude session] -.->|done| phone
  api --> agent
`

describe('weevils diagram', () => {
  it('reads the mermaid subset: labels, a second line, kinds given or guessed, what changed, new flows', () => {
    const d = parseDiagram(FLOW)
    expect(d.title).toBe('History now syncs')
    const by = Object.fromEntries(d.nodes.map((n: { id: string }) => [n.id, n]))
    expect(by.api).toMatchObject({ label: 'weevilsd', sub: 'on the VPS', kind: 'server' })
    expect(by.allow).toMatchObject({ kind: 'lock', state: 'new' })
    expect(by.phone.kind).toBe('phone')
    expect(by.agent.kind).toBe('agent')
    expect(by.hist.kind).toBe('data')
    expect(d.edges.find((e: { to: string }) => e.to === 'allow')).toMatchObject({ fresh: true, label: 'checks first' })
    expect(d.edges.find((e: { from: string }) => e.from === 'agent')).toMatchObject({ dashed: true, fresh: false })
  })

  it('lays parts out top to bottom, a part one row under what leads to it, loops ignored, 3 a row at most', () => {
    expect(rows(parseDiagram(FLOW))).toEqual([['phone'], ['api'], ['allow', 'hist', 'agent']])
    const wide = parseDiagram('flowchart TD\n a --> b\n a --> c\n a --> d\n a --> e\n')
    expect(rows(wide).map((r: string[]) => r.length)).toEqual([1, 3, 1])
  })

  it('refuses what would not read on a phone, in a plain sentence', () => {
    expect(() => parseDiagram('sequenceDiagram\n a->>b: hi')).toThrow(/flowchart TD/)
    expect(() => parseDiagram(`flowchart TD\n${Array.from({ length: 9 }, (_, i) => ` n${i} --> n${i + 1}`).join('\n')}`)).toThrow(/8 at most/)
    expect(() => parseDiagram('flowchart TD\n a[The weevilsd background daemon process] --> b')).toThrow(/too long/)
    expect(() => parseDiagram('flowchart TD\n a[session 3fa9c2e1] --> b')).toThrow(/plain words/)
  })

  it('draws tiles with their icons, a NEW tag and the staircase shadow on what changed', () => {
    const html = diagramPage(parseDiagram(FLOW))
    expect(html).toContain('History now syncs')
    expect(html).toContain('data-node="allow"')
    expect(html.match(/class="flag">NEW</g)).toHaveLength(1)
    expect(html).toContain(KINDS.lock.icon)
    expect(html).toMatch(/\.tile\.new,\.tile\.changed\{[^}]*3px 3px 0 #111,6px 6px 0 #128f00,9px 9px 0 #111/)
    expect(html).not.toMatch(/<script[^>]+src=/) // nothing loaded from the network
  })

  it('keeps every flow colour readable on the ground', () => {
    for (const c of [...Object.values(INK) as string[], FRESH]) expect(contrast(c, '#e9e6df')).toBeGreaterThanOrEqual(3)
    for (const k of Object.keys(KINDS)) expect(INK[k], k).toBeTruthy()
  })

  it('names its picture next to the source', () => {
    expect(defaultOut('/x/sync.mmd')).toBe('/x/sync.diagram.png')
  })
})

describe('weevils show <flow.mmd>', () => {
  it('draws the diagram first and says why when it cannot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-diagram-test-'))
    const bad = path.join(dir, 'bad.mmd')
    fs.writeFileSync(bad, 'pie\n "a": 1')
    const cli = path.join(import.meta.dirname, 'weevils-cli')
    const r = spawnSync('bash', [cli, 'show', bad, 'The sync'], { encoding: 'utf8', env: { ...process.env, WEEVILS_PORT: '1', WEEVILS_LANG: 'en', HOME: dir, WEEVILS_DIR: path.dirname(import.meta.dirname) } })
    fs.rmSync(dir, { recursive: true, force: true })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/weevils diagram: start with « flowchart TD »/)
  })
})
