// The guided tour of the interface (docs/onboarding.md): weevboss's thread offers it as a link (/#do=tour); the app that
// can play it (weevils next, next/src/tour.tsx) registers here, and the link starts it in place. The classic app has
// none: the link then asks the server, which says where the tour lives.
let host: (() => void) | null = null

/** next's tour registers itself; returns the unregister. */
export function tourHost(start: () => void): () => void {
  host = start
  return () => {
    if (host === start) host = null
  }
}

/** Starts the tour here when this app can play it. */
export const startTour = (): boolean => (host ? (host(), true) : false)
