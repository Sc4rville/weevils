// Signed-in browsers: one random token each, as a year-long cookie, kept in DATA_DIR/tokens.json together with a mark
// of the access code they signed in with (an HMAC, never the code). A new code (the README's « lost a phone » steps:
// a new ~/.config/weevils/secret, then a restart) signs every device out, even when tokens.json is left in place.
import crypto from 'node:crypto'
import fs from 'node:fs'

const codeMark = (secret: string) => crypto.createHmac('sha256', secret).update('weevils-devices').digest('base64url').slice(0, 22)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The devices signed in with this code. A bare list (written before the code was noted) is taken as this code's. */
export function loadTokens(file: string, secret: string): Set<string> {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(d)) return new Set(strings(d))
    if (d && typeof d === 'object' && d.code === codeMark(secret)) return new Set(strings(d.tokens))
  } catch {
    /* none yet, or unreadable: nobody signed in */
  }
  return new Set()
}

export function saveTokens(file: string, secret: string, tokens: Set<string>) {
  fs.writeFileSync(file, JSON.stringify({ code: codeMark(secret), tokens: [...tokens] }), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
