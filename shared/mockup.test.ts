// The mockup bank: which device or support a media of « For you » is shown in (shared/mockup.ts).
import { describe, expect, it } from 'vitest'
import { isMockup, pickMockup, screenRatio } from './mockup.ts'

const img = (name: string, w?: number, h?: number, mockup?: unknown) => ({ type: 'image' as const, name, w, h, mockup })
const vid = (name: string, w?: number, h?: number) => ({ type: 'video' as const, name, w, h })

describe('pickMockup', () => {
  it('a phone capture, a long scrolling one and a phone clip go in the phone', () => {
    expect(pickMockup(img('lab.png', 1170, 2532))).toBe('phone')
    expect(pickMockup(img('thread-long.png', 390, 2400))).toBe('phone')
    expect(pickMockup(vid('onboarding.mp4', 780, 1688))).toBe('phone')
  })

  it('a wide capture of a screen goes in a window, a wide render on a print, a wide clip on a screen', () => {
    expect(pickMockup(img('dashboard-desktop.png', 1440, 900))).toBe('browser')
    expect(pickMockup(img('screenshot-2026.png', 1920, 1080))).toBe('browser')
    expect(pickMockup(img('hero-render.png', 1920, 1080))).toBe('print')
    expect(pickMockup(vid('trailer.mp4', 1920, 1080))).toBe('cinema')
    expect(pickMockup(vid('browser-run.webm', 1280, 720))).toBe('browser')
  })

  it('4:3 named like a screen is a tablet; a square still is a print', () => {
    expect(pickMockup(img('settings-screen.png', 1536, 2048))).toBe('tablet')
    expect(pickMockup(img('app-ipad.png', 2048, 1536))).toBe('tablet')
    expect(pickMockup(img('cover.jpg', 1200, 1200))).toBe('print')
  })

  it('a diagram or a before/after is a board, whatever its shape', () => {
    expect(pickMockup(img('flow.diagram.png', 900, 1600))).toBe('board')
    expect(pickMockup(img('feed.compare.png', 1600, 1100))).toBe('board')
    expect(pickMockup(vid('nav.compare.mp4', 1080, 1920))).toBe('board')
    // Even when a phone was asked for: a phone's shape would cut the before/after.
    expect(pickMockup(img('chat.compare.png', 1376, 1484, 'phone'))).toBe('board')
  })

  it('size unknown yet: a still is a print, a clip a screen; a forced mockup wins', () => {
    expect(pickMockup(img('picture.png'))).toBe('print')
    expect(pickMockup(vid('clip.mp4'))).toBe('cinema')
    expect(pickMockup(img('lab.png', 1170, 2532, 'browser'))).toBe('browser')
    expect(pickMockup(img('lab.png', 1170, 2532, 'hologram'))).toBe('phone')
    expect(isMockup('board')).toBe(true)
    expect(isMockup('hologram')).toBe(false)
  })
})

describe('screenRatio', () => {
  it('keeps the media whole when the device allows, shows the top of a longer capture, never cuts a diagram', () => {
    expect(screenRatio('phone', 844 / 390)).toBeCloseTo(844 / 390)
    expect(screenRatio('phone', 2400 / 390)).toBe(2.17)
    // No drawn phone around it any more: a shorter capture of a phone screen stays whole.
    expect(screenRatio('phone', 1300 / 1000)).toBeCloseTo(1.3)
    expect(screenRatio('board', 1600 / 900)).toBeCloseTo(1600 / 900)
    expect(screenRatio('cinema', 0)).toBe(0.5625)
  })
})
