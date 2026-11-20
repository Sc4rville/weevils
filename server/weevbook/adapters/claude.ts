// Claude Code session lines → events (docs/spec/01-thread.md, the adapter contract, left column).
// The reader of server/transcripts.ts reads every line; this file says what that reader does not need: where a turn
// ends and where a pasted image is.

import type { Message } from '../../../shared/api.ts'
import { Adapter, type AdapterOptions } from './adapter.ts'

const INTERRUPTED = '[Request interrupted by user'

/** The texts of a `user` line: its string content, or its text parts. */
function texts(o: Record<string, any>): string[] {
  const c = o.message?.content
  if (typeof c === 'string') return [c]
  return Array.isArray(c) ? c.filter((p: any) => p?.type === 'text' && typeof p.text === 'string').map((p: any) => p.text) : []
}

export class ClaudeAdapter extends Adapter {
  readonly provider = 'claude' as const
  constructor(o: AdapterOptions) {
    super('claude', o)
  }

  // Claude Code writes one line per part of a reply (thinking, text, tool call), each with the reply's stop reason:
  // a reply that ends the turn may come as two lines, both saying end_turn.
  protected continues(o: Record<string, any>) {
    return o.type === 'assistant' && !!this.endedId && o.message?.id === this.endedId
  }

  // A message sent while the agent works is written as a queued_command attachment: Claude Code takes it into the
  // running turn. A plain `user` line that the reader did not recognise as a queued message is a new request.
  protected joins(o: Record<string, any>) {
    return o.type === 'attachment'
  }

  protected step(m: Message, o: Record<string, any>) {
    const part = Array.isArray(o.message?.content) ? o.message.content.find((p: any) => p?.type === 'tool_use' && p.id === m.id) : undefined
    const name = typeof part?.name === 'string' ? part.name : m.text.split(' · ')[0]
    // The app's own summary of the step (already redacted), with the leg's folder left out of paths.
    const cwd = this.cwd ?? this.t.cwd
    return { name, summary: cwd ? m.text.replaceAll(`${cwd}/`, '') : m.text }
  }

  protected files(o: Record<string, any>) {
    if (o.type !== 'user' || o.isMeta || o.isSidechain || !Array.isArray(o.message?.content)) return []
    return o.message.content
      .filter((p: any) => p?.type === 'image' && p.source?.type === 'base64' && typeof p.source.data === 'string' && typeof p.source.media_type === 'string')
      .map((p: any) => ({ mime: String(p.source.media_type).toLowerCase(), data: Buffer.from(p.source.data, 'base64') }))
  }

  protected signals(o: Record<string, any>) {
    if (o.isSidechain) return
    // The reader marks the session idle on a reply with stop_reason end_turn.
    if (o.type === 'assistant' && !o.isApiErrorMessage && this.t.phase === 'idle') this.ended(o.message?.id)
    // Esc: the user stopped the turn. Not a failure (04-resume.md): the turn is done.
    else if (o.type === 'user' && this.state === 'running' && texts(o).some((s) => s.trimStart().startsWith(INTERRUPTED))) this.close()
  }
}
