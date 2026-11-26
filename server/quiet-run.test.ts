// What « nothing happened » means for an automation run's card (server/quiet-run.ts): the words real runs wrote when
// they were skipped or found nothing, in English and French, against the words of runs that did something.
import { describe, expect, it } from 'vitest'
import { automationRunDir, saysNothingHappened } from './quiet-run.ts'

describe('saysNothingHappened', () => {
  it.each([
    "UI ad factory: I didn't start a batch. The factory is still stopped for the v2 rewrite.",
    'UI ad factory: run skipped, no batch started. You stopped the factory on 16 Nov.',
    '**Done:** I skipped this run. No batch was started and nothing was spent.',
    'Skipped: no ad batch was started this run.',
    'Done: I took the safe option, so no ad batch was started and nothing was spent.',
    'UI ad factory skipped: your stop flag from 16 Nov is still on.',
    "Today's GitHub polish was skipped again: I still can't see your subscription usage.",
    'Nothing left to do tonight.',
    'Done: Tonight was a quiet pass, since the last full scan is only a day old.',
    "I didn't walk through the app tonight, so there are no improvement ideas this time.",
    'No new leads this run.',
    'Kept paused',
    "J'ai sauté ce passage : l'usine est toujours arrêtée.",
    'Rien de nouveau depuis hier.',
    'Aucune nouvelle piste cette fois.',
  ])('nothing: %s', (text) => expect(saysNothingHappened({ text })).toBe(true))

  it.each([
    'Done: one ad batch started; it will make the next 4 ads.',
    '1 new lead worth a reply: https://example.com/p/leads',
    'Two new themes are ready, atlas and CRT.',
    'UX check tonight: 4 new issues.',
    'Tonight I tidied the weevils repo: sixty-one finished branches are gone.',
    'Deux nouveaux thèmes sont prêts.',
  ])('news: %s', (text) => expect(saysNothingHappened({ text })).toBe(false))

  it('the title counts, and a question to the person is never « nothing »', () => {
    expect(saysNothingHappened({ title: "UI ad factory: I didn't start a batch", text: 'The factory is still stopped.' })).toBe(true)
    expect(saysNothingHappened({ title: 'Resume the ad factory on the new cast?', text: 'I skipped this run.' })).toBe(false)
  })
})

describe('automationRunDir', () => {
  it('knows a run by its folder under .auto', () => {
    expect(automationRunDir('/home/u/projects/.auto/myshop-ads/a1b2c3d4e5')).toBe(true)
    expect(automationRunDir('/home/u/projects/.auto/.f6e5d4c3b2')).toBe(true)
    expect(automationRunDir('/home/u/projects/myshop')).toBe(false)
    expect(automationRunDir('/home/u/projects/auto-notes')).toBe(false)
    expect(automationRunDir(undefined)).toBe(false)
  })
})
