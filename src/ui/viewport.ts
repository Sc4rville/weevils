/** Follow the visible viewport without losing the iOS status-bar inset when the keyboard opens. */
export function trackViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const probe = document.createElement('div')
  probe.style.paddingTop = 'env(safe-area-inset-top, 0px)'
  probe.style.position = 'fixed'
  probe.style.visibility = 'hidden'
  document.body.append(probe)
  let safeTop = 0
  const update = () => {
    safeTop = Math.max(safeTop, parseFloat(getComputedStyle(probe).paddingTop) || 0)
    root.style.setProperty('--safe-t', `${safeTop}px`)
    root.style.setProperty('--vvh', `${vv.height}px`)
    root.style.setProperty('--vvt', `${vv.offsetTop}px`)
    const keyboard = window.innerHeight - vv.height > 150
    root.toggleAttribute('data-keyboard', keyboard)
    // Installed on an iPhone (black-translucent status bar), the viewport can come out a status bar short of the
    // screen: fixed screens then stop above the bottom edge and the window shows as a band. There, --full-h is the
    // screen's own height, for whatever must reach the bottom edge; nowhere else, and never with the keyboard open.
    const full = keyboard ? 0 : fullHeight(window, vv.height)
    if (full) root.style.setProperty('--full-h', `${full}px`)
    else root.style.removeProperty('--full-h')
  }
  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  // Safari may restore its viewport after focusout or a page-cache restore without
  // delivering another visualViewport event. Sample again after the keyboard animation.
  let settle: ReturnType<typeof setTimeout> | undefined
  const resample = () => {
    update()
    clearTimeout(settle)
    settle = setTimeout(update, 350)
  }
  window.addEventListener('resize', resample)
  window.addEventListener('pageshow', resample)
  document.addEventListener('focusout', resample)
  document.addEventListener('visibilitychange', resample)
  return () => {
    clearTimeout(settle)
    window.removeEventListener('resize', resample)
    window.removeEventListener('pageshow', resample)
    document.removeEventListener('focusout', resample)
    document.removeEventListener('visibilitychange', resample)
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    probe.remove()
    root.style.removeProperty('--safe-t')
    root.style.removeProperty('--vvh')
    root.style.removeProperty('--vvt')
    root.style.removeProperty('--full-h')
    root.removeAttribute('data-keyboard')
  }
}

/** The screen's whole height when an installed app's viewport comes out short of it (by a status bar at most), else 0. */
export function fullHeight(w: Pick<Window, 'innerHeight' | 'screen' | 'matchMedia' | 'navigator'>, visible: number): number {
  const standalone = (w.navigator as Navigator & { standalone?: boolean }).standalone === true || w.matchMedia?.('(display-mode: standalone)').matches
  if (!standalone) return 0
  const { width, height } = w.screen
  const screenH = w.matchMedia?.('(orientation: landscape)').matches ? Math.min(width, height) : Math.max(width, height)
  const have = Math.max(w.innerHeight, visible)
  return screenH > have && screenH - have <= 80 ? screenH : 0
}

/** --full-h alone (weevils next, which sizes its screens itself): the whole screen height while an installed app's
 *  viewport comes out short, removed with the keyboard open. */
export function trackFullHeight() {
  const root = document.documentElement
  const update = () => {
    const vv = window.visualViewport
    const visible = vv?.height ?? window.innerHeight
    const full = window.innerHeight - visible > 150 ? 0 : fullHeight(window, visible)
    if (full) root.style.setProperty('--full-h', `${full}px`)
    else root.style.removeProperty('--full-h')
  }
  update()
  window.visualViewport?.addEventListener('resize', update)
  window.addEventListener('resize', update)
  window.addEventListener('pageshow', update)
  return () => {
    window.visualViewport?.removeEventListener('resize', update)
    window.removeEventListener('resize', update)
    window.removeEventListener('pageshow', update)
    root.style.removeProperty('--full-h')
  }
}
