// ~/.claude.json belongs to Claude Code, which rewrites it all the time (every session: account, MCP servers, settings,
// projects). weevils only marks a folder as trusted in it, with care: nothing is written when the file can't be read or
// parsed (a write of Claude's caught halfway), the change is applied again to what is on disk right before writing,
// and the new file replaces the old one in one step (a temporary file in the same folder, renamed), with its mode.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

type Json = Record<string, any>
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** The file as it is: its text and data, null when it does not exist, undefined when it can't be trusted. */
function readNow(file: string): { raw: string; data: Json } | null | undefined {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined
  }
  try {
    const data = JSON.parse(raw)
    return isObject(data) ? { raw, data } : undefined
  } catch {
    return undefined
  }
}

/**
 * Applies `change` (true when it changed something) to the JSON file and writes it back, or leaves it alone: an
 * unreadable or unparseable file is never rewritten. A missing file is created (mode 0600). A symbolic link is kept:
 * the file it points to is the one replaced. Returns whether the file was written.
 */
export function updateJsonFile(file: string, change: (d: Json) => boolean): boolean {
  let target = file
  try {
    target = fs.realpathSync(file)
  } catch {
    /* missing: created where it is named */
  }
  const first = readNow(target)
  if (first === undefined) return false
  let data = first?.data ?? {}
  if (!change(data)) return false
  // Claude Code may have written meanwhile: the change goes on what is there now.
  const now = readNow(target)
  if (now === undefined) return false
  if ((now?.raw ?? null) !== (first?.raw ?? null)) {
    data = now?.data ?? {}
    if (!change(data)) return false
  }
  let mode = 0o600
  try {
    mode = fs.statSync(target).mode & 0o7777
  } catch {
    /* new file */
  }
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.weevils-${crypto.randomBytes(6).toString('hex')}.tmp`)
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode, flag: 'wx' })
    fs.chmodSync(tmp, mode)
    fs.renameSync(tmp, target)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
  return true
}

/** Marks folders as trusted in Claude Code's settings data (no « Do you trust this folder? » there). */
function markTrusted(d: Json, dirs: string[]): boolean {
  if (d.projects !== undefined && !isObject(d.projects)) return false
  d.projects ??= {}
  let changed = false
  for (const dir of dirs) {
    const p = d.projects[dir]
    if (isObject(p) && p.hasTrustDialogAccepted) continue
    d.projects[dir] = { ...(isObject(p) ? p : {}), hasTrustDialogAccepted: true }
    changed = true
  }
  return changed
}

/** Marks folders as trusted in a ~/.claude.json, with the care above. */
export const trustInClaudeJson = (file: string, dirs: string[]): boolean => updateJsonFile(file, (d) => markTrusted(d, dirs))
