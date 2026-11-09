import { describe, expect, it } from 'vitest'
import type { Message, Project, Session } from '../../shared/api.ts'
import { guessPreviewUrl, urlsInMessages } from './preview'

const msg = (text: string, i: number): Message => ({ id: String(i), role: 'assistant', text, at: i })
const session = { repo: 'mygame' } as Session
const project = { repos: ['mygame', 'other'] } as Project

describe('navigateur intégré : URL proposée', () => {
  it('prend l’URL exposée citée dans la conversation, la plus récente d’abord', () => {
    const m = [msg('voir http://localhost:4173/ pour tester.', 1), msg('publié : https://mygame.scarville.tech/jeu (et https://github.com/x/y)', 2)]
    expect(urlsInMessages(m)).toEqual(['https://mygame.scarville.tech/jeu', 'http://localhost:4173/'])
    expect(guessPreviewUrl(m, session, project)).toBe('https://mygame.scarville.tech/jeu')
  })
  it('sinon construit l’adresse à partir du repo', () => {
    expect(guessPreviewUrl([], session, project)).toBe('https://mygame.scarville.tech')
    expect(guessPreviewUrl([], { repo: null } as Session, project)).toBe('https://mygame.scarville.tech')
    expect(guessPreviewUrl([], { repo: null } as Session, undefined)).toBe('')
  })
  it('ignore weevils lui-même', () => {
    expect(urlsInMessages([msg('ouvre https://weevils.scarville.tech', 1)])).toEqual([])
  })
})
