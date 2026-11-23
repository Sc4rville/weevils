// The onboarding journey, after the hello (docs/onboarding.md): weevboss's thread stays the onboarding. Everything here
// is pure (tested in journey.test.ts); server/setup.ts says it, at the right moment, with no model:
//
// - the steps, one at a time, each offered by what it lets the person do: the tour of the interface, GitHub, the phone,
//   notifications, another machine. A step is offered once, only when the thread is calm; one the person passes by is
//   not offered again by weevils (weevboss may bring it back another day, see discoveries).
// - the milestones: a step passed is a real win (the app's confetti, once), with the use case it opens and one example
//   to try, a link that sends that very request to weevboss as the person's own.
// - the discoveries of the following days: weevboss, not weevils, slips in at most one a day, when it fits what the
//   person is doing; the hidden block of its turn carries the candidates and how many are left today (none or one).
import { TRIES, type Device, type Try } from '../shared/setup.ts'

/** The steps of the first session, in the order they are offered. */
export const STEPS = ['tour', 'github', 'phone', 'push', 'machine'] as const
export type Step = (typeof STEPS)[number]

/** What the journey reads of the real state (Setup.detect and its marks). */
export interface JourneyFacts {
  /** Claude or Codex signed in: weevboss can think, every step after it makes sense. */
  ready: boolean
  github: boolean
  /** The device the person first opened weevils on. */
  first?: Device
  /** Devices signed in now, and when the hello was said. */
  devices: number
  devicesAtHello: number
  push: number
  /** Another machine plugged in (any), or this one is on day and night. */
  others: number
  alwaysOn: boolean
  marks: Record<string, number>
}

/** A step is done by the real state; the tour by its own marks (finished or skipped). */
export function stepDone(step: Step, f: JourneyFacts): boolean {
  switch (step) {
    case 'tour':
      return !!(f.marks['tour:done'] || f.marks['tour:skip'])
    case 'github':
      return f.github
    case 'phone':
      // Opened on a phone first, or a second device signed in since.
      return !!f.first?.mobile || f.devices > Math.max(1, f.devicesAtHello)
    case 'push':
      return f.push > 0
    case 'machine':
      // A machine that sleeps gets the server offer (setup.ts watchSync, vps:*); one on day and night, another computer.
      return f.others > 0 || !!f.marks['vps:offer'] || !!f.marks['vps:later']
  }
}

/** The next step to offer: the first not done and not offered yet (each is offered once by weevils). */
export function nextStep(f: JourneyFacts): Step | null {
  if (!f.ready) return null
  return STEPS.find((s) => !stepDone(s, f) && !f.marks[`offer:${s}`]) ?? null
}

/** How long the thread stays quiet (no message, weevboss idle) before weevils offers the next step. */
export const CALM_MS = 90_000
/** Offers weevils makes by itself in a day, and after how many passed by in a row it stops (weevboss takes over). */
export const OFFERS_A_DAY = 3
export const IGNORED_IN_A_ROW = 2

/**
 * May weevils offer the next step now? Only in the first days, with weevboss idle, nothing new in the thread for
 * CALM_MS, under the day's cap, and not after the person passed two offers by in a row.
 */
export function mayOffer(o: { now: number; firstRunAt?: number; lastThreadAt: number; bossWorking: boolean; flowOpen: boolean; offers: number[]; ignored: number }): boolean {
  if (!o.firstRunAt || o.now - o.firstRunAt > 3 * 86_400_000) return false
  if (o.bossWorking || o.flowOpen) return false
  if (o.now - o.lastThreadAt < CALM_MS) return false
  if (o.ignored >= IGNORED_IN_A_ROW) return false
  return o.offers.filter((t) => o.now - t < 86_400_000).length < OFFERS_A_DAY
}

// ---------------------------------------------------------------- examples to try

/** One example per milestone: a link (/#do=try.<id>) that sends `say` to weevboss as the person's own request, with
 * `brief` for weevboss only. */
export { TRIES, type Try }
export const isTry = (x: string): x is Try => (TRIES as readonly string[]).includes(x)

/** What weevboss is told with an example the person tapped (never shown). */
export function tryBrief(t: Try): string {
  const lead = 'The user tapped an example to try from their onboarding (they chose it, it is their request now). Keep it small and quick, and show the result working.'
  return {
    notes: `${lead} Build a small, nice notes app in a new repo, in one session: add, edit and delete notes, kept in the browser. When it works, give them one living link to open it (weevils page or the dev server), in one short message.`,
    recap: `${lead} From their own past conversations (weevils recall, weevils sessions), say in three short lines what they worked on lately, each with a link to pick it up (/#s=<id>). Nothing yet: say so in one line and suggest one thing to start.`,
    status: `${lead} In three short lines: what their agents are doing right now, what waits on them, what finished; each with its link (/#s=<id>). Nothing running: say so in one line and suggest one thing to start.`,
    ping: `${lead} Start a tiny real job in a session (for example a one-minute check of one of their projects, or a small script that waits 60 seconds then prints done) so its end sends a notification to their phone. Say in one line that it pings them in about a minute, and that they can lock their phone meanwhile.`,
    machine: `${lead} Run \`weevils setup\` and look at the machine that just joined: what it is, its projects, and one concrete thing it is good for (agents running there while this one sleeps, its own conversations now in the app). Three lines at most.`,
  }[t]
}

// ---------------------------------------------------------------- the following days

/** What weevboss may slip in, one a day at most, when it fits what the person is doing. */
export interface Discovery {
  id: string
  /** Still worth saying (not done, not given). */
  open: (f: JourneyFacts) => boolean
  /** For the model: what it brings, when it fits, how to offer it. Never shown as is. */
  what: string
  when: string
  how: string
}

const step = (s: Step) => (f: JourneyFacts) => !stepDone(s, f)

export const DISCOVERIES: Discovery[] = [
  { id: 'github', open: (f) => !f.github, what: 'their conversations kept on their own GitHub, and agents saving code there', when: 'they start a new project, worry about losing work, or mention another computer', how: 'the link [Connect your GitHub](/#do=github)' },
  { id: 'phone', open: step('phone'), what: 'weevils on their phone: their agents in their pocket, answer from anywhere', when: 'they are on a computer and about to leave, or an agent will take a while', how: 'the link [put weevils on your phone](/#do=phone)' },
  { id: 'push', open: step('push'), what: 'a notification the moment an agent finishes or needs them, app closed', when: 'an agent of theirs is working or just finished while they were away', how: 'the link [turn on notifications](/#do=push)' },
  { id: 'machine', open: step('machine'), what: 'another machine: agents keep working while this one sleeps, or that computer\'s projects and conversations join here', when: 'they go to bed with a laptop, an agent was cut by sleep, or they mention another computer', how: 'on a machine that sleeps the link [set up a server](/#do=server); else [add your computer](/#do=computer)' },
  { id: 'tour', open: (f) => !f.marks['tour:done'], what: 'a one-minute guided tour of the interface', when: 'they ask where something is or how the app works', how: 'the link [take the tour](/#do=tour)' },
  { id: 'auto', open: (f) => !f.marks['discover:auto'], what: 'automations: something that runs on its own (a morning brief, a daily check of their site), shown under Autonomous', when: 'they ask for something they will want again, or say every day, every morning, keep an eye on', how: 'one sentence offering to make that very thing run on its own' },
  { id: 'voice', open: (f) => !f.marks['discover:voice'], what: 'talking instead of typing: the microphone in the field, or a tap on the weevboss logo', when: 'they type long messages, or write from their phone', how: 'half a sentence' },
  { id: 'camera', open: (f) => !f.marks['discover:camera'], what: 'the small camera on the edge of the screen: a tap, then a double tap, sends weevboss what they see', when: 'they describe something on screen, or a bug in what an agent made', how: 'half a sentence' },
  { id: 'codex', open: (f) => !f.marks['discover:codex'], what: 'ChatGPT (Codex) as a second subscription, so work goes on when Claude hits its limit', when: 'they hit a limit or mention ChatGPT', how: 'the link [connect ChatGPT](/#do=codex)' },
]

/** Discoveries open now, steps first, at most three for weevboss to pick from. */
export function candidates(f: JourneyFacts): Discovery[] {
  return DISCOVERIES.filter((d) => !f.marks[`discover:${d.id}`] && d.open(f)).slice(0, 3)
}

/** From the second day, one discovery a day; none while the first day's own offers are fresh. */
export const DISCOVERY_DAYS = 14
const DAY = 86_400_000

/** Last time something new was offered: a discovery weevboss gave, or a step or milestone weevils said. */
export function lastOffered(marks: Record<string, number>): number {
  return Math.max(0, ...Object.entries(marks).filter(([k]) => /^(discover|offer|won):/.test(k)).map(([, v]) => v))
}

/**
 * The hidden line for weevboss's turn: the candidates and that one may be said now, or nothing. From the morning after
 * the hello (20 hours) to two weeks, never twice in 24 hours, and at most `turns` messages of a day carry it.
 */
export function discoveryHint(f: JourneyFacts, o: { now: number; firstRunAt?: number; hintedToday: number }): string {
  if (!f.ready || !o.firstRunAt) return ''
  const age = o.now - o.firstRunAt
  if (age < 20 * 3600_000 || age > DISCOVERY_DAYS * DAY) return ''
  if (o.now - lastOffered(f.marks) < DAY || o.hintedToday >= 8) return ''
  const list = candidates(f)
  if (!list.length) return ''
  return [
    'one discovery for the user today, at most, and only if it truly fits what they are doing in this very message (else say nothing of it; a later message may fit).',
    'Make it concrete with what you know of them (their projects, their memory), one sentence at the end of your answer, never a list, never “by the way, did you know”.',
    `Candidates: ${list.map((d) => `${d.id} = ${d.what}; fits when ${d.when}; offer it as ${d.how}`).join(' | ')}.`,
    'Once you said one: `weevils setup mark discover:<id>`.',
  ].join(' ')
}
