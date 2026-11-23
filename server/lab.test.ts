import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Lab, statusOf, toReplay } from './lab.ts'

// The onboarding lab (docs/onboarding-lab.md): remarks in, results from the host, each change played again once.
describe('the onboarding lab', () => {
  it('a change built or undone is played again once', () => {
    expect(toReplay([{ id: 'a', status: 'built' }, { id: 'b', status: 'working' }, { id: 'c', status: 'undone' }], new Set(['c:undone']))).toEqual(['a:built'])
    expect(statusOf(null, new Set(), 'a')).toBe('waiting')
    expect(statusOf({ status: 'built', at: 1 }, new Set(), 'a')).toBe('working')
    expect(statusOf({ status: 'built', at: 1 }, new Set(['a:built']), 'a')).toBe('done')
    expect(statusOf({ status: 'failed', at: 1 }, new Set(), 'a')).toBe('failed')
  })

  it('a remark with its pictures, then the host’s result, then the step played again', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'))
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-data-'))
    const replay = vi.fn(async () => {})
    const lab = new Lab(dir, data, replay)
    const id = lab.remark('the hello is too long', ['weevboss: Hi'], [{ name: 'shot.jpg', data: Buffer.from('x') }])
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'remarks', `${id}.json`), 'utf8'))
    expect(saved).toMatchObject({ id, text: 'the hello is too long', context: ['weevboss: Hi'], photos: [`${id}-1.jpg`] })
    expect(lab.state().items).toEqual([expect.objectContaining({ id, status: 'waiting' })])
    fs.mkdirSync(path.join(dir, 'results'))
    fs.writeFileSync(path.join(dir, 'results', `${id}.json`), JSON.stringify({ status: 'built', change: 'Shorter hello.', at: 2 }))
    expect(lab.state().items[0]).toMatchObject({ status: 'working', change: 'Shorter hello.' })
    expect(await lab.tick()).toBe(true)
    expect(replay).toHaveBeenCalledOnce()
    expect(lab.state().items[0].status).toBe('done')
    expect(await lab.tick()).toBe(false)
    // A blank instance (new data) plays nothing of what came before it.
    const again = vi.fn(async () => {})
    expect(await new Lab(dir, fs.mkdtempSync(path.join(os.tmpdir(), 'lab-data-')), again).tick()).toBe(false)
    lab.request('undo', id)
    expect(fs.readdirSync(path.join(dir, 'requests'))).toHaveLength(1)
  })
})
