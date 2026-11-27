import { expect, it } from 'vitest'
import { autoBriefTitle, nightTask } from '../shared/auto-brief.ts'
import O from './i18n/optimizers.ts'

const facts = { branch: 'auto/x', checkout: '/repo', report: '/r.md', card: '/c.json', inRepo: true, writesReport: true, heavy: false, prompt: 'Do the thing.', minutes: 60, agreed: '' }

it('recognises the brief the server writes for a run, in every language it writes it in, and reads the name', () => {
  for (const l of ['fr', 'en'] as const) {
    expect(autoBriefTitle(O[l].brief({ ...facts, title: 'Night lens' }))).toBe('Night lens')
    expect(autoBriefTitle(O[l].brief({ ...facts, inRepo: false, title: 'Say "hello" to « them »' }))).toBe('Say "hello" to « them »')
  }
})

it('leaves every other message alone', () => {
  expect(autoBriefTitle('Please tidy the tests.')).toBeNull()
  expect(autoBriefTitle('I read that a Background task started by weevils went wrong.')).toBeNull()
  expect(autoBriefTitle('')).toBeNull()
})

it('a night task: the sleep trigger, or a window that opens at night', () => {
  expect(nightTask({ onSleep: true })).toBe(true)
  expect(nightTask({ window: { from: 60, to: 360 } })).toBe(true)
  expect(nightTask({ window: { from: 22 * 60, to: 120 } })).toBe(true)
  expect(nightTask({ window: { from: 9 * 60, to: 12 * 60 } })).toBe(false)
  expect(nightTask({})).toBe(false)
})
