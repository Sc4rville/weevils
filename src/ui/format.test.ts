import { afterAll, describe, expect, it } from 'vitest'
import { setLang } from '../i18n'
import { ago, dur, durLong, plural, status, step } from './format'

const MIN = 60_000

describe('format', () => {
  afterAll(() => setLang(null))

  it('parle français', () => {
    setLang('fr')
    expect(dur(12 * MIN)).toBe('12m')
    expect(dur(96 * MIN)).toBe('1h36')
    expect(dur(50 * 60 * MIN)).toBe('2j')
    expect(durLong(30_000)).toBe('moins d’une minute')
    expect(durLong(65 * MIN)).toBe('1 h 05')
    expect(durLong(25 * 60 * MIN)).toBe('1 jour')
    expect(ago(10_000)).toBe('à l’instant')
    expect(ago(5 * MIN)).toBe('il y a 5 min')
    expect(plural(0, 'fichier', 'fichiers')).toBe('0 fichier')
    expect(plural(2, 'fichier', 'fichiers')).toBe('2 fichiers')
    expect(status.needs_user.label).toBe('à toi')
    expect(step('Bash · Show hostname')).toBe('lance · Show hostname')
    expect(step('mcp__github__create_issue')).toBe('create issue')
    expect(step('constructor')).toBe('constructor')
  })

  it('speaks English', () => {
    setLang('en')
    expect(dur(50 * 60 * MIN)).toBe('2d')
    expect(durLong(65 * MIN)).toBe('1h 05m')
    expect(durLong(50 * 60 * MIN)).toBe('2 days')
    expect(ago(10_000)).toBe('just now')
    expect(ago(5 * MIN)).toBe('5 min ago')
    expect(plural(0, 'file', 'files')).toBe('0 files')
    expect(plural(1, 'file', 'files')).toBe('1 file')
    expect(status.needs_user.label).toBe('your turn')
    expect(status.working.ch).toBe('*')
    expect(step('Read · /home/me/x.ts')).toBe('reads · ~/x.ts')
  })
})
