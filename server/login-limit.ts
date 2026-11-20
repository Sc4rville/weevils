// Wrong access codes: a pause after each (800 ms, in index.ts), and a ceiling on how many may be tried. Per address
// (the client's real address, server/http.ts clientAddress), and for the whole machine so that many addresses together
// get no further. The right code always gets in: the ceiling slows guessing, it never locks the owner out. Devices
// already signed in keep their cookie.
export const PER_ADDRESS = 10
export const GLOBAL = 50
export const WINDOW_MS = 15 * 60_000

export function loginLimiter(now: () => number = Date.now) {
  const fails: { at: number; who: string }[] = []
  const prune = () => {
    const since = now() - WINDOW_MS
    while (fails.length && fails[0].at < since) fails.shift()
  }
  return {
    /** A sign-in with the right code or not: 'ok' always for the right one; a wrong one is 'wrong', or 'limited' once
     *  too many were tried (then it is not even counted). */
    attempt(who: string, right: boolean): 'ok' | 'wrong' | 'limited' {
      if (right) return 'ok'
      prune()
      if (fails.length >= GLOBAL || fails.filter((f) => f.who === who).length >= PER_ADDRESS) return 'limited'
      fails.push({ at: now(), who })
      return 'wrong'
    },
    /** Wrong codes remembered right now. */
    size: () => fails.length,
  }
}
