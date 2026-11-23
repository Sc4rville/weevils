// weevboss before the person's own Claude is signed in (docs/spec/07-vault.md « The onboarding »): a
// newcomer's questions get a real answer instead of the same sign-in link again. The instance's owner may lend a Claude
// sign-in for this (WEEVILS_GUEST_CLAUDE_DIR: a Claude Code config folder, signed in): it answers as weevboss, with no
// tool, no file and no session, a few sentences at most, and only until the person's own Claude is there.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { langName } from './boss-ledger.ts'

/** The lent sign-in's folder, when there is one with credentials in it. */
export function guestDir(env = process.env): string | null {
  const d = env.WEEVILS_GUEST_CLAUDE_DIR?.trim()
  return d && fs.existsSync(path.join(d, '.credentials.json')) ? d : null
}

/** At most this many answers per install: a loan for the first minutes, not a free subscription. */
export const GUEST_TURNS = 30

export interface GuestReply {
  text: string
  /** The person asked for something to be made or done: kept, and started once their own Claude is signed in. */
  task: boolean
}

// i18n-ignore: for the model, never shown
const ABOUT = `weevils, in facts (say only what is here):
- weevils is an app for the phone (a web app, added to the home screen) to make things with AI agents: the person says what they want (a game, a website, a small tool, a change in their code), weevboss hands it to an agent (Claude Code, or Codex with a ChatGPT subscription) that works on their own machine, and they follow it in the app, step by step, approving what matters.
- weevboss is the assistant at the top of the app: it talks with the person, starts and follows the agents' sessions, and reports.
- It runs on the person's own machine (their computer, or a server of theirs), with their own Claude subscription (Pro or Max) or ChatGPT subscription. weevils itself is free and open source; it never sees their password and adds no cost.
- Their code stays on their machine; their conversations with the agents are copied, encrypted, to a private repository on their own GitHub (once GitHub is connected), so they keep them whatever machine or subscription they use later.
- A small always-on server (about €5/month) is optional: it keeps working when their computer is off. weevboss offers it later; nothing to decide now.
- To start, the person signs in to their Claude once, with the link weevils shows in this conversation.`

// i18n-ignore: for the model, never shown
const RULES = (lang: string) => `You are weevboss, the assistant inside weevils, talking with someone who just installed it and has not signed in their own Claude yet. You are answering on a temporary connection until they do.
Write in ${langName(lang)}, plainly, for someone who may not be technical: 1 to 4 short sentences, no lists, no headings, no jargon, no emoji unless they use some.
Answer their question from the facts below. If they ask something you cannot know or do yet (look at their files, start work, change a setting), say so in a few words and that it works as soon as their Claude is signed in.
If they ask for something to be made or done, start your answer with the line TASK, then tell them you kept their request and will start it as soon as their Claude is signed in.
Never invent features, prices or steps. Never ask for a password or a key. Never write a link or explain how to sign in: weevils shows the sign-in link itself, next to your answer.

${ABOUT}`

/** Pure (tested): the model's raw answer → what weevboss says, and whether it was a request to keep. */
export function readGuest(raw: string): GuestReply | null {
  let text = raw.trim()
  const task = /^TASK\b/.test(text)
  if (task) text = text.replace(/^TASK\b[:.\s]*/, '').trim()
  // No link from the loan: the only link here is the sign-in's, written by weevils itself.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').trim()
  return text ? { text, task } : null
}

/** The conversation so far, as the model reads it: the last few lines, oldest first. */
export function guestPrompt(history: { role: 'user' | 'assistant'; text: string }[], text: string): string {
  const lines = history.slice(-10).map((m) => `${m.role === 'user' ? 'Them' : 'weevboss'}: ${m.text.replace(/\s+/g, ' ').slice(0, 600)}`)
  return `${lines.length ? `The conversation so far:\n${lines.join('\n')}\n\n` : ''}Their new message: ${text.slice(0, 2000)}`
}

/** One answer from the lent sign-in, or null (none lent, too slow, refused): the caller falls back to the sign-in link. */
export function guestAnswer(o: { dir: string; bin?: string; lang: string; history: { role: 'user' | 'assistant'; text: string }[]; text: string; timeoutMs?: number }): Promise<GuestReply | null> {
  return new Promise((resolve) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'weevils-guest-'))
    let over = false
    const done = (v: GuestReply | null) => {
      if (over) return
      over = true
      clearTimeout(timer)
      fs.rmSync(cwd, { recursive: true, force: true })
      resolve(v)
    }
    const args = ['-p', '--model', 'sonnet', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--system-prompt', RULES(o.lang), guestPrompt(o.history, o.text)]
    const proc = spawn(o.bin ?? 'claude', args, { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: o.dir }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('error', () => done(null))
    proc.on('close', (code) => done(code === 0 ? readGuest(out) : null))
    const timer = setTimeout(() => {
      proc.kill()
      done(null)
    }, o.timeoutMs ?? 60_000)
  })
}
