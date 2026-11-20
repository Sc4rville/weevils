// The one page a person sees when a chat app connects (docs/spec/05-connector.md#sign-in): which app, what it will be
// able to do, where the browser goes back to, and the access code unless this browser is already signed in. Plain
// HTML, no script, in the app's look: one full-height band of colour, bold type, sharp corners, no shadow.

import { lang, tr } from '../i18n.ts'
import M from '../i18n/connector.ts'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const STYLE = `
:root{color-scheme:light dark;--ink:#000;--band:#b39bff;--tone:color-mix(in oklab,var(--band) 87%,var(--ink));--font:-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--ink:#fff;--band:#5522b5}}
*{box-sizing:border-box;margin:0}
html,body{min-height:100%}
body{min-height:100dvh;background:var(--band);color:var(--ink);font:17px/1.4 var(--font);display:flex;flex-direction:column}
.in{padding:18px;max-width:640px;width:100%;margin:0 auto}
.name{font-size:30px;font-weight:800;letter-spacing:-.02em}
h1{font-size:24px;font-weight:800;line-height:1.15;letter-spacing:-.01em}
p,li{font-weight:600}
ul{padding-left:1.2em;margin-top:6px}
.meta{opacity:.75;font-weight:600}
.tone{background:var(--tone)}
.alert{background:var(--ink);color:var(--band);font-weight:700}
label{display:block;font-weight:800;margin-bottom:6px}
input{width:100%;font:inherit;font-weight:700;padding:12px;border:3px solid var(--ink);border-radius:0;background:transparent;color:var(--ink)}
.row{display:flex;gap:12px;margin-top:14px}
button{flex:1;font:inherit;font-weight:800;padding:14px;border:3px solid var(--ink);border-radius:0;cursor:pointer}
.yes{background:var(--ink);color:var(--band)}
.no{background:transparent;color:var(--ink)}
`

function page(title: string, body: string): string {
  return `<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><div class="in"><div class="name">weevils</div></div>${body}</body></html>`
}

export interface ConsentView {
  /** The chat app's name (ChatGPT, Claude), and the host the browser goes back to. */
  app: string
  host: string
  /** The consent request's id, carried by the form. */
  request: string
  /** This browser is signed in to weevils: no code to type. */
  signedIn: boolean
  error?: 'wrongCode' | 'tooMany'
}

export function consentPage(v: ConsentView): string {
  const t = tr(M)
  const alert = v.error ? `<div class="alert"><div class="in" role="alert">${esc(t[v.error])}</div></div>` : ''
  const code = v.signedIn
    ? `<p class="meta">${esc(t.signedIn)}</p>`
    : `<label for="code">${esc(t.code)}</label><input id="code" name="code" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required autofocus>`
  return page(t.title(v.app), `
<div class="in"><h1>${esc(t.title(v.app))}</h1><p style="margin-top:10px">${esc(t.asks(v.app))}</p></div>
<div class="tone"><div class="in"><p>${esc(t.can)}</p><ul><li>${esc(t.save(v.app))}</li><li>${esc(t.read)}</li><li>${esc(t.agent)}</li></ul><p style="margin-top:10px">${esc(t.cannot)}</p></div></div>
${alert}
<form method="post" action="/mcp/authorize" class="in">
<input type="hidden" name="request" value="${esc(v.request)}">
${code}
<div class="row"><button class="yes" type="submit" name="action" value="allow">${esc(t.allow)}</button><button class="no" type="submit" name="action" value="deny" formnovalidate>${esc(t.deny)}</button></div>
<p class="meta" style="margin-top:14px">${esc(t.back(v.host))} ${esc(t.revoke)}</p>
</form>`)
}

/** A request that cannot go on: one sentence, nothing sent back to the chat app. */
export function messagePage(key: 'expired' | 'invalid' | 'tooMany'): string {
  const t = tr(M)
  return page('weevils', `<div class="alert"><div class="in" role="alert">${esc(t[key])}</div></div>`)
}
