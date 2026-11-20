// Redaction of what enters the weevbook (docs/spec/02-weevbook.md#redaction). The patterns are those of
// redactToolText (server/codex-command-details.ts), used here with no length limit and only ever on one string at a
// time: a raw line is parsed, each string value inside it is redacted, and the line is written again only when one of
// them changed. Run over a JSON line as text, the patterns would break it (`"token":"x"` loses its quotes).

import { redactToolText } from '../codex-command-details.ts'

/** One string, whole: no cut at 8,000 characters. */
export const redactText = (s: string) => redactToolText(s, Infinity)

/** A key that names a secret (`api_key`, `Authorization`, `refresh_token`…): its string value is written as [redacted].
 *  The text patterns only see `name = value` inside one string; in a JSON object the name is the key. */
const SECRET_KEY = /(?:token|password|passwd|secret|api[_-]?key|authorization|cookie)/i
export const REDACTED = '[redacted]'

/**
 * Every string value inside `v`, redacted. Objects and arrays are copied only where something changed, so an
 * unchanged value comes back as the same object (`redactValue(o) === o`: nothing to redact).
 */
export function redactValue(v: unknown, key?: string): unknown {
  if (typeof v === 'string') {
    if (key !== undefined && SECRET_KEY.test(key) && v !== '' && v !== REDACTED) return REDACTED
    return redactText(v)
  }
  if (Array.isArray(v)) {
    let out: unknown[] | undefined
    v.forEach((x, i) => {
      const r = redactValue(x)
      if (r !== x) (out ??= v.slice())[i] = r
    })
    return out ?? v
  }
  if (v && typeof v === 'object') {
    let out: Record<string, unknown> | undefined
    for (const [k, x] of Object.entries(v)) {
      const r = redactValue(x, k)
      if (r !== x) (out ??= { ...(v as Record<string, unknown>) })[k] = r
    }
    return out ?? v
  }
  return v
}

/**
 * One line of a provider session as it is written to raw: the line itself when nothing in it is redacted (byte for
 * byte, so that a provider session rebuilt from raw is the provider's own file), the line written again as JSON when
 * a string changed. A line that is not JSON (cut by a crash) is kept as one JSON string, redacted as text: raw holds
 * JSON lines only (BOOK-6), and a raw line that parses to a string is such a line.
 * `parsed` is the line already parsed by the caller (undefined: parse it here; null is a valid JSON line).
 */
export function redactRawLine(line: string, parsed?: { value: unknown } | 'not-json'): string {
  let value: unknown
  if (parsed === 'not-json') return JSON.stringify(redactText(line))
  if (parsed) value = parsed.value
  else {
    try {
      value = JSON.parse(line)
    } catch {
      return JSON.stringify(redactText(line))
    }
  }
  const r = redactValue(value)
  return r === value ? line : JSON.stringify(r)
}

/** Every string field of an event, redacted (docs/spec/02-weevbook.md: « Events: every string field »). */
export function redactEvent<T extends object>(e: T): T {
  return redactValue(e) as T
}
