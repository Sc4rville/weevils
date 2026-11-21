// The two places a For you post can lead that are not pages (src/ui/foryou-open.ts): weevboss's thread, and the list
// of what runs on its own. The classic app has a thread band and a drawer for them; next has its weevboss screen and
// its side bar. Written once here so that neither is ever a tap that does nothing (reach.test.ts).
export interface Reach {
  /** Every page pushed over weevboss's screen is closed. */
  closePages: () => void
  setSide: (open: boolean) => void
  /** weevboss comes down over a session, when one is open. */
  bossDown: () => void
  /** weevboss's thread, not For you, on its screen. */
  showThread: () => void
  /** The Autonomous section of the side bar, unfolded. */
  unfoldAutos: () => void
}

/** weevboss's thread, whatever was on screen. */
export function toBoss(r: Reach) {
  r.closePages()
  r.setSide(false)
  r.bossDown()
  r.showThread()
}

/** The side bar, on its Autonomous section. */
export function toAutos(r: Reach) {
  r.closePages()
  r.unfoldAutos()
  r.setSide(true)
}
