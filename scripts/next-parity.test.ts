// What the classic app does that weevils next takes as it is, so it follows by itself (docs/next-interaction.md,
// « From the classic app »): its settings band whole, its notifications, its page links. Any of them dropped from
// next, or rebuilt there as a copy, fails here.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const next = fs.readFileSync(path.join(root, 'next/src/main.tsx'), 'utf8')

it('next shows the app’s own settings band, its machines, subscriptions and Tempo moved to factory', () => {
  expect(next).toMatch(/<FootBand switchTo="classic" factory( mark=\{[^\n]*\})? \/>/)
  expect(next).toMatch(/<FactorySection /)
  expect(next).not.toMatch(/<LanguageLine|<TempoLine|<UsageLine/)
})

it('next gets the app’s notifications and opens what they point to', () => {
  expect(next).toMatch(/registerWorker\(\)/)
  expect(next).toMatch(/useWorker\(/)
  expect(fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')).toMatch(/version\?\.ui === 'next'/)
})

it('next opens a page link signed in only now, as the app does', () => {
  expect(next).toMatch(/pageLink\(location\.pathname\)/)
})
