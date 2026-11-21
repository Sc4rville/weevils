// Slim raw (docs/spec/07-vault.md, « What goes where »): the provider's own lines as the vault keeps them. Two cuts,
// nothing else:
//
//   1. a tool result over 20 KB keeps its first and last 8 KB with a marker between, `[… 412 KB kept on <machine> …]`,
//      naming the machine that has the full output. An image cannot be cut in the middle (the provider would refuse
//      the conversation): an image over 20 KB inside a tool result becomes that marker alone;
//   2. Claude Code's `toolUseResult` (its own copy of the result, which the model never reads) is dropped over 2 KB.
//
// Everything else stays byte for byte. A line with nothing to cut is the same bytes; a line that is cut is spliced as
// text, never parsed and written again: only the cut value changes, so a signed block (`thinking`, Codex's
// `encrypted_content`), a uuid or a number next to it keeps every byte it had. Lines keep their order.
//
//   Claude    message.content[] of type tool_result: `content` as a string, or its `text` and `image` blocks;
//             the line's own `toolUseResult`
//   Codex     response_item payloads custom_tool_call_output and function_call_output: `output` as a string, or its
//             `input_text` and `input_image` items; event_msg item_completed of a CommandExecution: `aggregated_output`

import type { Provider } from './journal.ts'

/** A tool result over this is cut; what is kept at each end; a `toolUseResult` over this is dropped. */
export const RESULT_MAX = 20 << 10
export const RESULT_KEEP = 8 << 10
export const TOOL_USE_RESULT_MAX = 2 << 10

/** The marker left where bytes were cut (`what`: "image" for a picture that went whole). */
export const slimMarker = (bytes: number, machine: string, what = '') => `[… ${what ? `${what}, ` : ''}${Math.max(1, Math.round(bytes / 1024))} KB kept on ${machine} …]`

// ---------------------------------------------------------------- JSON, by position

class Bad extends Error {}

const ws = (s: string, i: number) => {
  for (;;) {
    const c = s.charCodeAt(i)
    if (c === 32 || c === 10 || c === 13 || c === 9) i++
    else return i
  }
}

/** `i` at a string's opening quote: the index after its closing quote. */
function endOfString(s: string, i: number): number {
  for (let j = i + 1; ; j++) {
    j = s.indexOf('"', j)
    if (j < 0) throw new Bad()
    let b = j - 1
    while (s.charCodeAt(b) === 92) b--
    if ((j - 1 - b) % 2 === 0) return j + 1
  }
}

interface Member { key: string; ks: number; vs: number; ve: number }

/** The members of the object at `i`: each key, where it starts, and its value's span. */
function members(s: string, i: number): { list: Member[]; end: number } {
  if (s.charCodeAt(i) !== 123) throw new Bad()
  const list: Member[] = []
  let j = ws(s, i + 1)
  if (s.charCodeAt(j) === 125) return { list, end: j + 1 }
  for (;;) {
    if (s.charCodeAt(j) !== 34) throw new Bad()
    const ks = j
    const ke = endOfString(s, j)
    j = ws(s, ke)
    if (s.charCodeAt(j) !== 58) throw new Bad()
    const vs = ws(s, j + 1)
    const ve = endOfValue(s, vs)
    // A key with an escape in it is none of the names looked for here.
    list.push({ key: s.slice(ks + 1, ke - 1), ks, vs, ve })
    j = ws(s, ve)
    const c = s.charCodeAt(j)
    if (c === 125) return { list, end: j + 1 }
    if (c !== 44) throw new Bad()
    j = ws(s, j + 1)
  }
}

/** The elements of the array at `i`: each one's span. */
function elements(s: string, i: number): { list: { vs: number; ve: number }[]; end: number } {
  if (s.charCodeAt(i) !== 91) throw new Bad()
  const list: { vs: number; ve: number }[] = []
  let j = ws(s, i + 1)
  if (s.charCodeAt(j) === 93) return { list, end: j + 1 }
  for (;;) {
    const ve = endOfValue(s, j)
    list.push({ vs: j, ve })
    j = ws(s, ve)
    const c = s.charCodeAt(j)
    if (c === 93) return { list, end: j + 1 }
    if (c !== 44) throw new Bad()
    j = ws(s, j + 1)
  }
}

function endOfValue(s: string, i: number): number {
  const c = s.charCodeAt(i)
  if (c === 34) return endOfString(s, i)
  if (c === 123) return members(s, i).end
  if (c === 91) return elements(s, i).end
  let j = i
  // A number, true, false or null: up to the next comma, bracket or space.
  for (; j < s.length; j++) {
    const d = s.charCodeAt(j)
    if (d === 44 || d === 125 || d === 93 || d === 32 || d === 10 || d === 13 || d === 9) break
  }
  if (j === i) throw new Bad()
  return j
}

const isObject = (s: string, i: number) => s.charCodeAt(i) === 123
const isArray = (s: string, i: number) => s.charCodeAt(i) === 91
const isString = (s: string, i: number) => s.charCodeAt(i) === 34
const find = (list: Member[], key: string) => list.find((m) => m.key === key)
/** The value of a member when it is this plain string (`"type":"tool_result"`). */
const says = (s: string, m: Member | undefined, value: string) => !!m && isString(s, m.vs) && m.ve - m.vs === value.length + 2 && s.startsWith(value, m.vs + 1)
const bytesOf = (s: string, from: number, to: number) => (to - from > RESULT_MAX ? to - from : Buffer.byteLength(s.slice(from, to)))

interface Edit { from: number; to: number; text: string }

/** The first `max` bytes of a string, never half a character. */
function head(text: string, max: number): string {
  let n = 0
  let i = 0
  while (i < text.length) {
    const c = text.codePointAt(i)!
    const b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
    if (n + b > max) break
    n += b
    i += c > 0xffff ? 2 : 1
  }
  return text.slice(0, i)
}
/** The last `max` bytes of a string, never half a character. */
function tail(text: string, max: number): string {
  let n = 0
  let i = text.length
  while (i > 0) {
    let c = text.charCodeAt(i - 1)
    let w = 1
    if (c >= 0xdc00 && c <= 0xdfff && i > 1 && text.charCodeAt(i - 2) >= 0xd800 && text.charCodeAt(i - 2) <= 0xdbff) {
      c = text.codePointAt(i - 2)!
      w = 2
    }
    const b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
    if (n + b > max) break
    n += b
    i -= w
  }
  return text.slice(i)
}

/** The string literal at [vs, ve) cut when its text is over 20 KB. */
function cutString(s: string, vs: number, ve: number, machine: string, edits: Edit[]) {
  // A literal is never shorter than its text in bytes over three (one UTF-16 unit is at most three bytes).
  if ((ve - vs) * 3 <= RESULT_MAX) return
  const text = JSON.parse(s.slice(vs, ve)) as string
  const bytes = Buffer.byteLength(text)
  if (bytes <= RESULT_MAX) return
  const a = head(text, RESULT_KEEP)
  const z = tail(text, RESULT_KEEP)
  edits.push({ from: vs, to: ve, text: JSON.stringify(`${a}\n${slimMarker(bytes - Buffer.byteLength(a) - Buffer.byteLength(z), machine)}\n${z}`) })
}

/**
 * A tool's output at [vs, ve): a string, or an array of blocks. `textType`/`imageType` are the block types of the
 * provider (`text`/`image` for Claude, `input_text`/`input_image` for Codex).
 */
function cutOutput(s: string, vs: number, ve: number, machine: string, edits: Edit[], textType: string, imageType: string) {
  if (isString(s, vs)) return cutString(s, vs, ve, machine, edits)
  if (!isArray(s, vs) || (ve - vs) * 3 <= RESULT_MAX) return
  for (const el of elements(s, vs).list) {
    if (!isObject(s, el.vs)) continue
    const m = members(s, el.vs).list
    const type = find(m, 'type')
    if (says(s, type, textType)) {
      const t = find(m, 'text')
      if (t && isString(s, t.vs)) cutString(s, t.vs, t.ve, machine, edits)
    } else if (says(s, type, imageType) && bytesOf(s, el.vs, el.ve) > RESULT_MAX) {
      edits.push({ from: el.vs, to: el.ve, text: JSON.stringify({ type: textType, text: slimMarker(bytesOf(s, el.vs, el.ve), machine, 'image') }) })
    }
  }
}

function claudeEdits(s: string, machine: string, edits: Edit[]) {
  const top = members(s, ws(s, 0)).list
  const tur = find(top, 'toolUseResult')
  if (tur && (isObject(s, tur.vs) || isArray(s, tur.vs)) && bytesOf(s, tur.vs, tur.ve) > TOOL_USE_RESULT_MAX) {
    // The member goes with one comma: the one before it, or the one after when it is the first.
    const i = top.indexOf(tur)
    if (i > 0) edits.push({ from: top[i - 1].ve, to: tur.ve, text: '' })
    else if (top.length > 1) edits.push({ from: tur.ks, to: top[1].ks, text: '' })
    else edits.push({ from: tur.ks, to: tur.ve, text: '' })
  }
  const message = find(top, 'message')
  if (!message || !isObject(s, message.vs)) return
  const content = find(members(s, message.vs).list, 'content')
  if (!content || !isArray(s, content.vs)) return
  for (const el of elements(s, content.vs).list) {
    if (!isObject(s, el.vs) || (el.ve - el.vs) * 3 <= RESULT_MAX) continue
    const m = members(s, el.vs).list
    if (!says(s, find(m, 'type'), 'tool_result')) continue
    const c = find(m, 'content')
    if (c) cutOutput(s, c.vs, c.ve, machine, edits, 'text', 'image')
  }
}

function codexEdits(s: string, machine: string, edits: Edit[]) {
  const top = members(s, ws(s, 0)).list
  const payload = find(top, 'payload')
  if (!payload || !isObject(s, payload.vs)) return
  const p = members(s, payload.vs).list
  const type = find(p, 'type')
  if (says(s, find(top, 'type'), 'response_item') && (says(s, type, 'custom_tool_call_output') || says(s, type, 'function_call_output'))) {
    const out = find(p, 'output')
    if (out) cutOutput(s, out.vs, out.ve, machine, edits, 'input_text', 'input_image')
  } else if (says(s, find(top, 'type'), 'event_msg') && says(s, type, 'item_completed')) {
    const item = find(p, 'item')
    if (!item || !isObject(s, item.vs)) return
    const it = members(s, item.vs).list
    if (!says(s, find(it, 'type'), 'CommandExecution')) return
    const out = find(it, 'aggregated_output')
    if (out && isString(s, out.vs)) cutString(s, out.vs, out.ve, machine, edits)
  }
}

/**
 * One raw line, slim. The same string comes back when nothing is cut. `machine` is named in the markers: the machine
 * that keeps the full line.
 */
export function slimLine(line: string, provider: Provider, machine: string): string {
  if (line.length <= TOOL_USE_RESULT_MAX / 3) return line
  if (provider === 'claude' ? !line.includes('"toolUseResult"') && !line.includes('"tool_result"') : !line.includes('_call_output"') && !line.includes('"aggregated_output"')) return line
  const edits: Edit[] = []
  try {
    if (provider === 'claude') claudeEdits(line, machine, edits)
    else codexEdits(line, machine, edits)
  } catch {
    return line // not the JSON object expected (a line cut by a crash is kept as a JSON string): as it is
  }
  if (!edits.length) return line
  edits.sort((a, b) => a.from - b.from)
  let out = ''
  let at = 0
  for (const e of edits) {
    if (e.from < at) return line // two cuts over one span: never expected, nothing is cut
    out += line.slice(at, e.from) + e.text
    at = e.to
  }
  out += line.slice(at)
  try {
    JSON.parse(out)
  } catch {
    return line
  }
  return out
}

/**
 * A raw segment (or the bytes appended to one), slim: whole lines, in order. A line that is not cut is the identical
 * bytes. `yieldEvery`: gives the event loop back after that many milliseconds of work (weevilsd's pusher).
 */
export async function slimRaw(raw: Buffer, provider: Provider, machine: string, yieldEvery = 0): Promise<Buffer> {
  const parts: Buffer[] = []
  let from = 0 // the start of the run of unchanged bytes
  let changed = false
  let t0 = Date.now()
  for (let i = 0; i < raw.length; ) {
    let nl = raw.indexOf(10, i)
    if (nl < 0) nl = raw.length
    if (nl - i > TOOL_USE_RESULT_MAX / 3) {
      const line = raw.toString('utf8', i, nl)
      // Bytes that are not UTF-8 would not survive the splice: such a line is kept as it is.
      const slim = Buffer.byteLength(line) === nl - i ? slimLine(line, provider, machine) : line
      if (slim !== line) {
        if (i > from) parts.push(raw.subarray(from, i))
        parts.push(Buffer.from(slim))
        from = nl
        changed = true
      }
      if (yieldEvery && Date.now() - t0 >= yieldEvery) {
        await new Promise<void>((r) => setImmediate(r))
        t0 = Date.now()
      }
    }
    i = nl + 1
  }
  if (!changed) return raw
  if (from < raw.length) parts.push(raw.subarray(from))
  return Buffer.concat(parts)
}
