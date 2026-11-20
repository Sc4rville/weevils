// Codex session lines → events (docs/spec/01-thread.md, the adapter contract, right column).
// The reader of server/transcripts.ts reads every line; this file says where a turn starts and ends, how a tool step
// is summed up without the app's translated labels, and where a pasted image is.

import type { Message } from '../../../shared/api.ts'
import { commandDetails } from '../../codex-command-details.ts'
import { toolSummary } from '../../transcripts.ts'
import { redactText } from '../redact.ts'
import { Adapter, type AdapterOptions } from './adapter.ts'

export class CodexAdapter extends Adapter {
  readonly provider = 'codex' as const
  constructor(o: AdapterOptions) {
    super('codex', o)
  }

  // A Codex reply is one line: nothing continues it.
  protected continues() {
    return false
  }

  // Codex queues a message sent during a turn and takes it into that turn (the same line as any request).
  protected joins() {
    return true
  }

  /** `exec_command · git diff --stat`: the tool's own name, then the first of description, file path, command,
   *  pattern, URL, query. A command is the one the app shows in its details (redacted the same way). */
  protected step(_m: Message, o: Record<string, any>) {
    const p = o.payload ?? {}
    const name: string = typeof p.name === 'string' && p.name ? p.name : 'local_shell_call'
    let input: unknown = p.arguments ?? p.input ?? p.action ?? {}
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input)
      } catch {
        /* free-form input (a patch): no detail */
      }
    }
    const fields = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
    const command = commandDetails(name, input, Infinity)[0]
    let summary = redactText(toolSummary(name, { ...fields, command: command ?? (typeof fields.command === 'string' ? fields.command : undefined) }))
    const cwd = this.cwd ?? this.t.cwd
    if (cwd) summary = summary.replaceAll(`${cwd}/`, '')
    return { name, summary }
  }

  protected files(o: Record<string, any>) {
    const p = o.payload
    if (o.type !== 'response_item' || p?.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) return []
    const out: { mime: string; data: Buffer }[] = []
    for (const c of p.content) {
      const m = c?.type === 'input_image' && typeof c.image_url === 'string' ? /^data:([\w/+.-]+);base64,(.*)$/s.exec(c.image_url) : null
      if (m) out.push({ mime: m[1].toLowerCase(), data: Buffer.from(m[2], 'base64') })
    }
    return out
  }

  protected signals(o: Record<string, any>) {
    if (o.type !== 'event_msg') return
    const kind = o.payload?.type
    if (kind === 'task_started') this.starting()
    else if ((kind === 'task_complete' || kind === 'turn_aborted') && this.state === 'running') this.close()
  }

  // Codex keeps a thread's name apart from its lines (~/.codex/session_index.jsonl): the writer hands it over.
  protected titleNow() {
    return this.externalTitle || super.titleNow()
  }
}
