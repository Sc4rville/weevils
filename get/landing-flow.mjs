// The landing (landing.html) and the install steps (index.html) are two pages but one install: the landing loads
// /flow.js, which is index.html's own script with three changes, made here on every request so the install it runs
// is always the one index.html holds (its tests, its fixes). The changes: a step is drawn in the room the landing
// opens over itself (window.wvRoom), « home » closes that room instead of drawing the old start, and the boot ends
// without drawing that start. Should index.html change shape so a change no longer applies, buildFlow returns null
// and the server serves index.html at / as before: the install never breaks for the landing's sake.

const SHOW = `const show = (...sections) => {
  // The landing is the start: a step is drawn in its room, which opens over the page (landing.html, wvRoom).
  show.home = false
  setBack(null)
  app.replaceChildren(...sections.filter(Boolean))
  window.wvRoom?.open(app)
}
`
const HOME = `function home(notice) {
  step('')
  setChat({ pick: '' })
  if (typeof notice === 'string' && notice) return show(band('b5', h('div', { class: 'err' }, notice)))
  // Back to the landing: the room closes, nothing else to draw.
  setBack(null)
  app.replaceChildren()
  window.wvRoom?.close()
}
`
const TAIL = "  if (at === 'computer') return computer ? pcHere() : pc(true)\n  home()\n})()"

function cut(text, start, end, replacement) {
  const a = text.indexOf(start)
  if (a < 0) return null
  const b = text.indexOf(end, a)
  if (b < 0) return null
  return text.slice(0, a) + replacement + text.slice(b)
}

/** index.html → the landing's install script, or null when index.html no longer has the expected shape. */
export function buildFlow(html) {
  const open = "<script>\n'use strict'"
  const a = html.indexOf(open)
  const b = html.lastIndexOf('</script>')
  if (a < 0 || b < a) return null
  let js = html.slice(a + '<script>\n'.length, b)
  js = cut(js, 'const show = (...sections) => {', 'const errBox', SHOW)
  if (js) js = cut(js, 'function home(notice) {', '/** This computer, picked', HOME)
  if (!js || js.split(TAIL).length !== 2) return null
  return '// Built by get/landing-flow.mjs from index.html on each request: change index.html, not this.\n' + js.replace(TAIL, "  if (at === 'computer') return computer ? pcHere() : pc(true)\n})()")
}
