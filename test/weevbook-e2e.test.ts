// Step 1 of docs/spec, end to end: the sessions of test/fixtures/weevbook backfilled into a fresh data dir with the
// `weevils weevbook` command, then checked and compared with what the app shows. Zero losses, and a second backfill
// changes nothing.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const FX = path.resolve(import.meta.dirname, 'fixtures/weevbook/home')
const home = process.env.HOME!
const data = path.join(home, 'data')
// Projects are folders under /home/alex/projects in the fixtures (config.ts reads it when first imported).
process.env.WEEVILS_PROJECTS = '/home/alex/projects'
const { main } = await import('../server/weevbook/cli.ts')

const args = ['--data-dir', data, '--claude-dir', path.join(home, 'fx/claude/projects'), '--codex-dir', path.join(home, 'fx/codex/sessions')]
async function run(...cmd: string[]) {
  const lines: string[] = []
  const code = await main([...cmd, ...args], (l) => lines.push(l))
  return { code, out: lines.join('\n') }
}
/** Every file of the data dir, the repository included, by content. */
function snapshot(dir: string, base = dir, out: Record<string, string> = {}) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) snapshot(p, base, out)
    else out[path.relative(base, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  }
  return out
}

describe('weevils weevbook backfill, check, compare', () => {
  beforeAll(() => fs.cpSync(FX, path.join(home, 'fx'), { recursive: true }))

  it('backfills every session with something said, one thread each', async () => {
    const r = await run('backfill')
    expect(r.out).toContain('5 sessions: 3 threads created, 0 extended, 0 already up to date, 2 without a message')
    expect(r.out).toMatch(/main composed: [0-9a-f]{12}/)
    expect(r.code).toBe(0)
    const index = JSON.parse(fs.readFileSync(path.join(data, 'weevbook/index.json'), 'utf8'))
    expect(index.threads.map((t: { title: string; project: string | null }) => [t.title, t.project])).toEqual([
      ['Checkout fixes', 'shop-app'],
      ['Itinerary PDF export', 'trip-planner'],
      ['Summarize meeting.md in three bullets.', null],
    ])
  })

  it('validates every thread: no invariant broken', async () => {
    const r = await run('check')
    expect(r.out).toBe('3 threads, 103 events checked\nno invariant broken')
    expect(r.code).toBe(0)
  })

  it('compares with what the app shows: zero losses, intended differences counted apart', async () => {
    const r = await run('compare')
    expect(r.out).toBe([
      '5 sessions: 3 compared, 3 identical, 2 without a message',
      '35 messages and steps in the app: 33 identical in the weevbook',
      'intended differences: 1 redacted (secret), 0 long (as an attachment), 1 provider errors (failed turn)',
      'no loss',
    ].join('\n'))
    expect(r.code).toBe(0)
  })

  it('a second backfill changes nothing', async () => {
    const before = snapshot(data)
    const r = await run('backfill')
    expect(r.out).toContain('5 sessions: 0 threads created, 0 extended, 3 already up to date, 2 without a message')
    expect(r.out).toContain('0 events and 0 raw lines written')
    expect(r.out).toContain('main unchanged')
    expect(snapshot(data)).toEqual(before)
  })

  it('a message altered in the weevbook is a loss, and breaks the folder', async () => {
    const thread = JSON.parse(fs.readFileSync(path.join(data, 'weevbook/index.json'), 'utf8')).threads[0].path
    const file = path.join(data, 'weevbook', thread, 'events.jsonl')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Use the euro sign for now', 'Use the dollar sign'))
    const compare = await run('compare')
    expect(compare.out).toContain('altered (said): 1')
    expect(compare.out).toContain('LOSSES: 1')
    expect(compare.code).toBe(1)
    const check = await run('check')
    expect(check.code).toBe(1)
    expect(check.out).toMatch(/BOOK-\d+: \d+/)
  })
})
