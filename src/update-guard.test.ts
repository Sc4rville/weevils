// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { updateIsBusy } from './update-guard'
afterEach(() => { document.body.replaceChildren(); document.getSelection()?.removeAllRanges(); vi.restoreAllMocks() })
it('waits for a draft, pending send, media playback or text selection before updating', () => {
 const composer = document.createElement('form')
 composer.className = 'composer'
 document.body.append(composer)
 expect(updateIsBusy()).toBe(false)
 composer.dataset.draft = 'true'
 expect(updateIsBusy()).toBe(true)
 delete composer.dataset.draft
 composer.setAttribute('aria-busy', 'true')
 expect(updateIsBusy()).toBe(true)
 composer.removeAttribute('aria-busy')
 const audio = document.createElement('audio')
 document.body.append(audio)
 const playing = vi.spyOn(audio, 'paused', 'get').mockReturnValue(false)
 expect(updateIsBusy()).toBe(true)
 playing.mockReturnValue(true)
 expect(updateIsBusy()).toBe(false)
 const text = document.createTextNode('Keep this selection')
 document.body.append(text)
 const range = document.createRange()
 range.selectNodeContents(text)
 document.getSelection()!.addRange(range)
 expect(updateIsBusy()).toBe(true)
 document.getSelection()!.removeAllRanges()
 expect(updateIsBusy()).toBe(false)
})
