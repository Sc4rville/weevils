import { expect, it } from 'vitest'
import { needsTitle, stableTitle, TitleRetry } from './titles.ts'
it('keeps the subject through work steps and changes it only for an explicit new topic', () => {
  expect(stableTitle('Le feed pour toi', 'Déploie le tri')).toBe('Le feed pour toi')
  expect(stableTitle('Le feed pour toi', 'Apparence et réglages', true)).toBe('Apparence et réglages')
  expect(stableTitle(undefined, 'Version open source')).toBe('Version open source')
})

it('blocks repeated title attempts while transcripts keep arriving and resets after success', () => {
  const retry = new TitleRetry()
  expect(retry.ready(0)).toBe(true)
  retry.failed(0)
  for (let at = 8000; at < 300_000; at += 8000) expect(retry.ready(at)).toBe(false)
  expect(retry.ready(300_000)).toBe(true)
  retry.failed(300_000)
  expect(retry.ready(899_999)).toBe(false)
  expect(retry.ready(900_000)).toBe(true)
  retry.succeeded()
  retry.failed(900_000)
  expect(retry.ready(1_200_000)).toBe(true)
})
it('bounds title retry delay at one hour', () => {
  const retry = new TitleRetry()
  for (let i = 0; i < 20; i++) retry.failed(0)
  expect(retry.ready(3_599_999)).toBe(false)
  expect(retry.ready(3_600_000)).toBe(true)
})

it('a title follows the current work: the namer is asked for topicChanged in every answer format, on a new request too', async () => {
  const M = (await import('./i18n/titles.ts')).default
  for (const l of ['en', 'fr'] as const) {
    // Without Codex (no output schema) the format said in the prompt is all the model sees: it must carry the field,
    // or no title ever moves again.
    expect(M[l].jsonOnly).toContain('"topicChanged"')
    const p = M[l].prompt('Alex', '[]')
    expect(p).not.toMatch(/ONLY when the user explicitly|UNIQUEMENT si l’utilisateur demande explicitement/)
    expect(p).toMatch(/previousTitle/)
  }
})

it('a long session is renamed too: its window of messages stops growing, a newer message still counts', () => {
  const MIN = 60_000, T = 1_000 * MIN
  const prev = { title: 'Polishing newcomer settings', now: 'x', at: T, messageCount: 400 }
  // Same window size, nothing new since the last naming: nothing to do.
  expect(needsTitle(prev, 400, true, T + 10 * MIN, T - MIN)).toBe(false)
  // Same window size, newer messages: named again (the two-minute pace still holds).
  expect(needsTitle(prev, 400, true, T + MIN, T + 30_000)).toBe(false)
  expect(needsTitle(prev, 400, true, T + 10 * MIN, T + 5 * MIN)).toBe(true)
  expect(needsTitle(prev, 400, false, T + 10 * MIN, T + 5 * MIN)).toBe(true)
})
