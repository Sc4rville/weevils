/** A version update must wait until ongoing interaction can safely survive navigation. */
export function updateIsBusy(): boolean {
  // A dictation records or transcribes (src/ui/dictation.ts), even from a box no longer on screen.
  return !!document.documentElement.dataset.dictation
    || !!document.querySelector('.markdown-editor[data-draft="true"], .markdown-editor[aria-busy="true"], .voice[data-voice-busy="true"], .voice-logo.rec, .voice-logo.wait, .composer[aria-busy="true"], .composer[data-draft="true"], .fy-reply[aria-busy="true"], .fy-reply[data-draft="true"], .fy-acts[aria-busy="true"]')
    || [...document.querySelectorAll<HTMLMediaElement>('audio, video')].some(el => !el.paused)
    || !!document.getSelection()?.toString()
}
