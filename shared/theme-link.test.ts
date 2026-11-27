import { describe, expect, it } from 'vitest'
import { cleanThemeIds, isThemeLink, themeHash, themeIds, withoutTheme } from './theme-link.ts'

describe('theme link', () => {
  it('reads the themes a hash or an address asks for, in order, each once', () => {
    expect(themeIds('#theme=departures')).toEqual(['departures'])
    expect(themeIds('https://weevils.example.com/#theme=departures,newsprint,departures')).toEqual(['departures', 'newsprint'])
    expect(themeIds('#k=abc&theme=crt')).toEqual(['crt'])
    expect(themeIds('#theme=art%20deco,deco')).toEqual(['deco'])
    expect(themeIds('#s=theme=dark')).toEqual([])
    expect(themeIds('https://weevils.example.com/?theme=dark')).toEqual([])
    expect(themeIds('#theme=<script>,UPPER,')).toEqual([])
    expect(themeIds(undefined)).toEqual([])
  })

  it('a theme link says nothing else: a bare hash or an address whose hash is only that', () => {
    expect(isThemeLink('#theme=zen')).toBe(true)
    expect(isThemeLink('https://weevils.example.com/#theme=zen,dark')).toBe(true)
    expect(isThemeLink('https://weevils.example.com/#s=abc&theme=zen')).toBe(false)
    expect(isThemeLink('https://weevils.example.com/p/library/new-themes')).toBe(false)
    expect(isThemeLink('#theme=')).toBe(false)
  })

  it('keeps only well-formed ids, and takes the request out of an address once applied', () => {
    expect(cleanThemeIds(['zen', 'zen', 42, 'No', 'a-b'])).toEqual(['zen', 'a-b'])
    expect(cleanThemeIds('zen')).toEqual([])
    expect(themeHash(['zen', 'dark'])).toBe('#theme=zen,dark')
    expect(withoutTheme('#theme=zen')).toBe('')
    expect(withoutTheme('#s=abc&theme=zen')).toBe('#s=abc')
    expect(withoutTheme('')).toBe('')
  })
})
