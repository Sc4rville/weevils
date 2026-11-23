// The line of a machine that does not answer (src/ui/away.tsx): plain words for each reason, and « since » as a person
// says it (a time today, « yesterday », else a date).
import { afterEach, expect, it } from 'vitest'
import { setLang } from '../i18n'
import M from '../i18n/away'
import { awayText, sinceWhen } from './away'

afterEach(() => setLang(null))

it('says why in plain words, and since when', () => {
  setLang('en')
  const now = new Date(2026, 10, 23, 18, 0).getTime()
  const at = new Date(2026, 10, 23, 15, 3).getTime()
  const time = new Date(at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  expect(awayText(M.en, 'kusaila', { why: 'link', since: at }, now)).toBe(`No news from kusaila since ${time}: it’s off or asleep, or weevils on it lost its link.`)
  expect(awayText(M.en, 'kusaila', { why: 'stopped', since: at }, now)).toBe(`kusaila is on, but weevils on it hasn’t answered since ${time}.`)
  expect(awayText(M.en, 'kusaila', { why: 'key', since: null }, now)).toBe('kusaila answers but no longer lets this machine in: it needs an update.')
  expect(awayText(M.fr, 'kusaila', { why: 'link', since: null }, now)).toBe('Aucune nouvelle de kusaila : il est éteint ou en veille, ou weevils y a perdu son lien.')
  expect(sinceWhen(new Date(2026, 10, 22, 9, 30).getTime(), now, (t) => `yesterday ${t}`)).toMatch(/^yesterday /)
  expect(sinceWhen(new Date(2026, 10, 2, 9, 30).getTime(), now, (t) => `yesterday ${t}`)).toMatch(/Nov/)
})
