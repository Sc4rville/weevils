import { describe, expect, it } from 'vitest'
import { copyLink, keySource, readCopyLink } from './key-sources.ts'

describe('where a key comes from', () => {
  it('GitHub and npm sign in by a link; the others open on the page that creates the key', () => {
    expect(keySource('GITHUB_TOKEN').login).toBe('github')
    expect(keySource('GH_TOKEN').login).toBe('github')
    expect(keySource('NPM_TOKEN')).toEqual({ login: 'npm' })
    expect(keySource('OPENAI_API_KEY')).toEqual({ create: 'https://platform.openai.com/api-keys' })
    expect(keySource('HF_TOKEN').create).toContain('huggingface.co/settings/tokens')
    // A provider weevils does not know: nothing invented, the field alone.
    expect(keySource('ACME_API_KEY')).toEqual({})
  })
  it('a link that copies a code and opens the page reads back, and nothing else does', () => {
    const link = copyLink('https://github.com/login/device', 'AB12-CD34')
    expect(link).toBe('/#open=https%3A%2F%2Fgithub.com%2Flogin%2Fdevice&copy=AB12-CD34')
    expect(readCopyLink(link.slice(1))).toEqual({ url: 'https://github.com/login/device', code: 'AB12-CD34' })
    expect(readCopyLink('#open=javascript%3Aalert(1)&copy=AB12-CD34')).toBeUndefined()
    expect(readCopyLink('#open=http%3A%2F%2Fexample.com&copy=AB12-CD34')).toBeUndefined()
    expect(readCopyLink('#open=https%3A%2F%2Fexample.com&copy=a%20b')).toBeUndefined()
    expect(readCopyLink('#open=%E0%A4%A&copy=AB12-CD34')).toBeUndefined()
    expect(readCopyLink('#do=github')).toBeUndefined()
  })
})
