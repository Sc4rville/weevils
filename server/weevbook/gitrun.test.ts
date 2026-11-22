import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GC_EVERY, gentleGc, gentleGcCommand } from './gitrun.ts'

describe('a gentle gc of weevils\' own repositories', () => {
  it('runs on one core, at the lowest priority: the background class on a Mac, nice elsewhere', () => {
    const mac = gentleGcCommand('darwin', true)
    expect(mac.slice(0, 2)).toEqual(['/usr/sbin/taskpolicy', '-b'])
    const linux = gentleGcCommand('linux')
    expect(linux.slice(0, 3)).toEqual(['nice', '-n', '19'])
    expect(gentleGcCommand('darwin', false)[0]).toBe('nice')
    for (const c of [mac, linux]) {
      expect(c).toContain('pack.threads=1')
      expect(c.slice(-3)).toEqual(['gc', '--auto', '--quiet'])
    }
  })

  it('runs at most once an hour for one repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gentle-gc-'))
    try {
      const marker = path.join(dir, 'ran')
      const command = ['sh', '-c', `echo "$GIT_DIR" >> '${marker}'`]
      const t0 = 1_000_000
      expect(await gentleGc(path.join(dir, 'a.git'), { now: t0, command })).toBe(true)
      expect(await gentleGc(path.join(dir, 'a.git'), { now: t0 + GC_EVERY - 1, command })).toBe(false)
      expect(await gentleGc(path.join(dir, 'b.git'), { now: t0 + 1, command })).toBe(true)
      expect(await gentleGc(path.join(dir, 'a.git'), { now: t0 + GC_EVERY, command })).toBe(true)
      expect(fs.readFileSync(marker, 'utf8').trim().split('\n')).toEqual([path.join(dir, 'a.git'), path.join(dir, 'b.git'), path.join(dir, 'a.git')])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
