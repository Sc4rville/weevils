import { describe, expect, it } from 'vitest'
import { linkText, postLink, privateHost } from './post-link.ts'

describe('the direct link of a post', () => {
  it('keeps a web address and its label, and says the host when there is no label', () => {
    expect(postLink('https://new-site.example.com')).toEqual({ url: 'https://new-site.example.com/' })
    expect(postLink(' https://shop.example.com/menu ', '  The   new menu ')).toEqual({ url: 'https://shop.example.com/menu', label: 'The new menu' })
    expect(linkText({ url: 'https://new-site.example.com/' })).toBe('new-site.example.com')
    expect(linkText({ url: 'https://www.example.com/menu/' })).toBe('example.com/menu')
    expect(linkText({ url: 'https://x.dev/', label: 'Open the site' })).toBe('Open the site')
  })

  it('never a localhost, loopback, private or local-name link, never anything but http(s)', () => {
    for (const u of ['http://localhost:5173', 'http://127.0.0.1:4179/', 'http://[::1]:3000', 'http://0.0.0.0:8080', 'http://192.168.1.20', 'http://10.0.0.4', 'http://172.20.1.1', 'http://mybox.local', 'http://app.localhost', 'http://vps:4173', 'http://100.101.1.2'])
      expect(postLink(u), u).toBe('local')
    for (const u of ['', 'ftp://example.com', 'javascript:alert(1)', 'example.com', 'https://user:pw@example.com', 42]) expect(postLink(u), String(u)).toBe('url')
    expect(privateHost('new-site.example.com')).toBe(false)
    expect(privateHost('172.32.0.1')).toBe(false)
  })
})
