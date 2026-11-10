import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Memory, memoryRoutes } from './memory.ts'

// What weevils remembers about the user (server/memory.ts): a temp file, never the real ~/.config/weevils/memory.json.
const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'sub', 'memory.json')

describe('Memory store', () => {
  it('adds, lists newest first, updates, removes, and persists in a 600 file', () => {
    const file = fresh()
    const m = new Memory(file)
    expect(m.count).toBe(0)
    const a = m.add('  wants   to ship a mobile game\nthis year ')
    expect(a.text).toBe('wants to ship a mobile game this year')
    expect(a.source).toBe('manual')
    const b = m.add('runs on coffee', { source: 'answer', q: 'what keeps you going?', a: 'coffee, mostly' })
    expect(b).toMatchObject({ source: 'answer', q: 'what keeps you going?', a: 'coffee, mostly' })
    b.updatedAt = a.updatedAt + 1
    expect(m.list().map((x) => x.id)).toEqual([b.id, a.id])
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)

    // A hand edit changes the words only: the item keeps where it came from (its weevil question and answer).
    const edited = m.update(b.id, 'runs on tea now')
    expect(edited).toMatchObject({ text: 'runs on tea now', source: 'answer', q: 'what keeps you going?', a: 'coffee, mostly' })
    const again = m.update(a.id, 'ships the game in June', { q: 'and the game?', a: 'June' })
    expect(again).toMatchObject({ source: 'manual', q: 'and the game?', a: 'June' })

    m.remove(a.id)
    m.remove('nope')
    const back = new Memory(file)
    expect(back.list().map((x) => x.text)).toEqual(['runs on tea now'])
  })

  it('refuses an empty text and an unknown id', () => {
    const m = new Memory(fresh())
    expect(() => m.add('   ')).toThrow()
    expect(() => m.update('nope', 'x')).toThrow()
    const a = m.add('x')
    expect(() => m.update(a.id, ' ')).toThrow()
  })

  it('caps the text length and the number of items (the oldest go), in memory and on disk', () => {
    const file = fresh()
    const m = new Memory(file)
    expect(m.add('y'.repeat(2000)).text).toHaveLength(400)
    for (let i = 0; i < 305; i++) m.add(`item ${i}`)
    expect(m.count).toBe(300)
    expect(new Memory(file).count).toBe(300)
    expect(m.list().some((x) => x.text === 'item 0')).toBe(false)
    expect(m.list().some((x) => x.text === 'item 304')).toBe(true)
  })

  it('reads a broken or partial file as empty, skipping malformed items', () => {
    const file = fresh()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{not json')
    expect(new Memory(file).count).toBe(0)
    fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'a', text: 'ok', source: 'manual', at: 1, updatedAt: 1 }, { nope: 1 }, null] }))
    const m = new Memory(file)
    expect(m.count).toBe(1)
    expect(m.asked()).toEqual([])
  })

  it('tells its listeners after every change', () => {
    const m = new Memory(fresh())
    const fn = vi.fn()
    const off = m.onChange(fn)
    const a = m.add('x')
    m.update(a.id, 'y')
    m.remove(a.id)
    expect(fn).toHaveBeenCalledTimes(3)
    off()
    m.add('z')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('asText, digest and signature for the prompts', () => {
    const m = new Memory(fresh())
    expect(m.asText()).toBe('')
    expect(m.digest()).toBe('')
    expect(m.signature()).toBe('')
    const a = m.add('likes climbing')
    const b = m.add('wants a quiet week')
    b.updatedAt = a.updatedAt + 1
    expect(m.asText()).toBe(`- [${b.id}] wants a quiet week\n- [${a.id}] likes climbing`)
    expect(m.asText(1)).toBe(`- [${b.id}] wants a quiet week`)
    expect(m.digest()).toBe('- wants a quiet week\n- likes climbing')
    expect(m.digest(12, 25)).toBe('- wants a quiet week')
    const sig = m.signature()
    expect(sig).toMatch(/^[0-9a-f]{16}$/)
    expect(m.signature()).toBe(sig)
    m.update(a.id, 'loves climbing')
    expect(m.signature()).not.toBe(sig)
  })
})

describe('weevils questions', () => {
  it('ask, markAsked (misses counted, answered sticks), askedText newest first', () => {
    const file = fresh()
    const m = new Memory(file)
    const q1 = m.ask('what would you like right now?')
    const q2 = m.ask('and in ten years?')
    expect(q1.state).toBe('pending')
    m.markAsked(q1.id, 'shown')
    m.markAsked(q1.id, 'shown')
    expect(m.question(q1.id)).toMatchObject({ state: 'shown', misses: 2 })
    m.markAsked(q2.id, 'answered')
    m.markAsked(q2.id, 'shown')
    expect(m.question(q2.id)?.state).toBe('answered')
    m.markAsked('nope', 'answered')
    expect(m.askedText()).toBe('- and in ten years?\n- what would you like right now? (no answer)')
    expect(new Memory(file).asked()).toHaveLength(2)
  })

  it('keeps at most 400 questions', () => {
    const m = new Memory(fresh())
    for (let i = 0; i < 405; i++) m.ask(`q${i}`)
    expect(m.asked()).toHaveLength(400)
    expect(m.asked()[0].text).toBe('q5')
  })
})

describe('memory routes', () => {
  const call = async (m: Memory, method: string, url: string, body: unknown = {}) => {
    const routes = memoryRoutes(m, (_res, status, out) => void (res = { status, out }), async () => body)
    let res: { status: number; out: any } = { status: 0, out: null }
    for (const [verb, re, h] of routes) {
      const hit = verb === method && re.exec(url)
      if (hit) {
        await h({} as never, {} as never, new URL(`http://x${url}`), hit.slice(1))
        return res
      }
    }
    throw new Error(`no route ${method} ${url}`)
  }
  it('list, add, edit, delete, with 400 on empty and 404 on unknown', async () => {
    const m = new Memory(fresh())
    expect((await call(m, 'POST', '/api/memory', { text: '  ' })).status).toBe(400)
    const added = await call(m, 'POST', '/api/memory', { text: 'plays the piano' })
    expect(added.status).toBe(200)
    const id = added.out.item.id
    expect((await call(m, 'GET', '/api/memory')).out.items).toHaveLength(1)
    expect((await call(m, 'PUT', `/api/memory/${id}`, { text: 'plays the cello' })).out.item.text).toBe('plays the cello')
    expect((await call(m, 'PUT', '/api/memory/nope', { text: 'x' })).status).toBe(404)
    expect((await call(m, 'PUT', `/api/memory/${id}`, { text: '' })).status).toBe(400)
    expect((await call(m, 'DELETE', `/api/memory/${id}`)).out).toEqual({ ok: true })
    expect(m.count).toBe(0)
  })
})
