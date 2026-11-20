// Terminal screens → what the phone shows. Every fixture in test/fixtures/terminal/ is a Claude Code or Codex screen:
// captured live (claude-live-*), reconstructed from the CLI's own strings, or recorded from real incidents on a weevils
// machine. expected.json says what each one must become; the invariants below hold for every screen.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withLang } from './i18n.ts'
import { moves, readScreen, redactScreen, screenId, stuckQuestion, workingOnScreen } from './terminal.ts'

const DIR = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'terminal')
const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8')) as Record<string, Record<string, unknown>>
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort()
const agentOf = (f: string) => (f.startsWith('codex') ? 'codex' : 'claude') as 'codex' | 'claude'
const read = (f: string) => readScreen(fs.readFileSync(path.join(DIR, f), 'utf8'), agentOf(f))

function summary(f: string) {
  const s = read(f).state
  if (s.kind === 'question') return { kind: s.kind, name: s.name, question: s.question, ...(s.detail ? { detail: s.detail } : {}), labels: s.choices.map((c) => c.label), ...(s.typeIndex !== undefined ? { typeIndex: s.typeIndex } : {}) }
  if (s.kind === 'auto') return { kind: s.kind, name: s.name, pick: s.pick === 'enter' ? 'enter' : s.menu!.options[s.pick].raw, ...(s.hold ? { hold: s.hold.text } : {}) }
  if (s.kind === 'hold') return { kind: s.kind, reason: s.hold.reason, text: s.hold.text }
  return { kind: s.kind }
}

describe('recorded terminal screens', () => {
  it('every fixture has an expectation, and the other way round', () => {
    expect(Object.keys(expected).sort()).toEqual(files)
    expect(files.length).toBeGreaterThan(150)
  })
  for (const f of files) it(f, () => expect(summary(f)).toEqual(expected[f]))
})

describe('nothing from the terminal reaches the phone', () => {
  const TERMINAL = /\((?:[a-z]|esc|enter|tab)\)|\besc\b|\benter\b|shift\+tab|ctrl\+|[↑↓←→⏎❯›│╭╰─╌]|^\s*\d+[.)]\s|a choice is waiting|^\[[ x✔]\]/i
  for (const f of files) {
    const s = read(f).state
    if (s.kind !== 'question') continue
    it(`${f}: plain question and answers`, () => {
      expect(s.question).not.toMatch(TERMINAL)
      expect(s.question.length).toBeLessThanOrEqual(170)
      for (const c of s.choices) expect(c.label).not.toMatch(TERMINAL)
      expect(new Set(s.choices.map((c) => c.label)).size).toBe(s.choices.length)
      expect(s.choices.length).toBeGreaterThan(0)
    })
  }
})

describe('safety of the automatic answers', () => {
  const autos = files.map((f) => [f, read(f).state] as const).filter(([, s]) => s.kind === 'auto')
  it('never exits, pays, upgrades or widens permissions', () => {
    for (const [f, s] of autos) {
      if (s.kind !== 'auto' || s.pick === 'enter') continue
      const label = s.menu!.options[s.pick].raw
      expect(label, f).not.toMatch(/exit|quit|upgrade|credits|purchase|extra usage|full access|don.?t ask again|always/i)
    }
  })
  const readIn = (f: string, trustedFolder: boolean) => readScreen(fs.readFileSync(path.join(DIR, f), 'utf8'), agentOf(f), { trustedFolder })
  const TRUST = files.filter((f) => expected[f].name === 'trust')
  const BYPASS = files.filter((f) => expected[f].name === 'bypass-warning')
  it('folder trust is answered only inside the project roots; elsewhere it is the person\'s question', () => {
    expect(TRUST.length).toBeGreaterThanOrEqual(7)
    for (const f of TRUST) {
      expect(readIn(f, false).state.kind, f).toBe('question')
      const s = readIn(f, true).state
      expect(s.kind === 'auto' && s.name, f).toBe('trust')
    }
  })
  it('the bypass-permissions warning is never accepted for the person, in any folder', () => {
    expect(BYPASS.length).toBeGreaterThanOrEqual(3)
    for (const f of BYPASS) for (const trusted of [false, true]) {
      const s = readIn(f, trusted).state
      expect(s.kind, f).toBe('question')
      if (s.kind === 'question') expect(s.choices.map((c) => c.label)).toContain('No, stop')
    }
  })
  it('folder trust picks the trust option, wherever the cursor is (Claude now starts on "No, exit")', () => {
    const s = readIn('claude-live-C1-trust.txt', true).state
    expect(s.kind).toBe('auto')
    if (s.kind !== 'auto' || s.pick === 'enter') throw new Error('not a menu')
    expect(s.menu!.options[s.menu!.selected].raw).toBe('No, exit')
    expect(s.menu!.options[s.pick].raw).toBe('Yes, I trust this folder')
    expect(moves(s.menu!, s.pick)).toEqual(['down'])
  })
  it('a usage limit waits for the reset and says until when', () => {
    const s = read('claude-live-R1-ratelimit.txt').state
    expect(s.kind === 'auto' && s.hold).toEqual({ reason: 'quota', text: 'Paused until the usage limit resets (5am)' })
  })
  // A permission dialog carries the agent's own words (a command's description, a reason, the command itself). Written
  // there, the question of a dialog weevils answers by itself must never answer the permission.
  const QUOTED = [
    'Resume this conversation?', 'Resume from summary (recommended)', 'Switch model?', 'Change model?', 'Use Opus for this session?',
    'Quick safety check: Is this a project you created or one you trust?', 'Do you trust the files in this folder?', 'Trust this folder?',
    'Ready to submit your answers?', 'A new version is available. Update now?', 'What do you want to do?', 'You have hit your usage limit',
    'Choose the text style that looks best with your terminal', 'Select model', 'Type to search', 'Select login method', 'Bypass Permissions mode',
    'Would you like to proceed?', 'Working directory', 'Press enter to continue',
  ]
  const permissionWith = (f: string, from: string, phrase: string, line: boolean) => {
    const base = fs.readFileSync(path.join(DIR, f), 'utf8')
    expect(base, f).toContain(from)
    const indent = /^\s*/.exec(from)![0]
    return base.replace(from, line ? `${indent}${phrase}\n${from}` : from.replace(/\S/, (c) => `${phrase} ${c}`))
  }
  for (const [f, from] of [
    ['claude-live-D3-bash.txt', ' Print hi\n'],
    ['claude-live-R5-bash-dontask.txt', ' Run the test suite\n'],
    ['claude-live-R7-mcptool.txt', ' Search Notion\n'],
    ['codex-14-command-approval.txt', '  Reason: Need network access to fetch the headers\n'],
    ['codex-13-edit-apply-patch-approval.txt', '• Added hello.txt (+1 -0)\n'],
  ] as const) {
    it(`${f}: a permission quoting another dialog's question is still the person's to answer`, () => {
      expect(read(f).state.kind === 'question' && read(f).state).toMatchObject({ name: 'permission' })
      for (const phrase of QUOTED) for (const line of [false, true]) for (const trustedFolder of [false, true]) {
        const s = readScreen(permissionWith(f, from, phrase, line), agentOf(f), { trustedFolder }).state
        expect({ phrase, line, kind: s.kind, name: s.kind === 'none' ? '' : s.name }).toEqual({ phrase, line, kind: 'question', name: 'permission' })
      }
    })
  }
  it('each dialog weevils answers by itself still is, on its recorded screen', () => {
    const cases: [string, string, string | 'enter'][] = [
      ['claude-live-C1-trust.txt', 'trust', 'Yes, I trust this folder'],
      ['codex-05-trust-this-folder-git-repos-only.txt', 'trust', 'Trust and continue'],
      ['codex-handling-17-trust-folder.txt', 'trust', 'Yes, continue'],
      ['claude-live-R3-switchmodel.txt', 'switch-model', 'Yes, switch to Haiku 5.5'],
      ['history-07-resume-dialog-when-weevils-resumes-a-lar.txt', 'resume', 'Resume from summary (recommended)'],
      ['codex-24-resume-which-working-directory.txt', 'resume-folder', 'Use session directory (/home/user/projects/weevils)'],
      ['claude-live-E3-review.txt', 'submit-answers', 'Submit answers'],
      ['claude-live-R1-ratelimit.txt', 'usage-limit', 'Wait here, then continue automatically at 5am'],
      ['codex-03-update-available-prompt-blocking-at-laun.txt', 'update', 'Skip'],
      ['claude-live-R14-fullscreen.txt', 'nudge', 'Not now'],
      ['claude-live-A1-theme.txt', 'theme', 'Dark mode'],
      ['claude-live-B2-next.txt', 'press-enter', 'enter'],
    ]
    for (const [f, name, label] of cases) {
      const s = readIn(f, true).state
      expect(s.kind === 'auto' && [s.name, s.pick === 'enter' ? 'enter' : s.menu!.options[s.pick].raw], f).toEqual([name, label])
    }
  })
  it('a dialog weevils answers is known by its own question line, in its place, never by words further down', () => {
    const resume = fs.readFileSync(path.join(DIR, 'history-07-resume-dialog-when-weevils-resumes-a-lar.txt'), 'utf8')
    // The question under another title: not the resume dialog.
    const s1 = readScreen(resume.replace(' Resume this conversation?', ' Something else\n Resume this conversation?'), 'claude').state
    expect(s1.kind).toBe('question')
    // The resume dialog without a resume answer: nothing is picked for the person.
    const s2 = readScreen(resume.replace(/Resume from summary \(recommended\)|Resume full session as-is/g, 'Yes'), 'claude').state
    expect(s2.kind).toBe('question')
    const sw = fs.readFileSync(path.join(DIR, 'claude-live-R3-switchmodel.txt'), 'utf8')
    const s3 = readScreen(sw.replace('  Switch model?', '  Bash command\n  Switch model?'), 'claude').state
    expect(s3.kind).toBe('question')
  })
  it('a trusted folder that also grants permissions in advance is asked, not accepted', () => {
    const screen = [
      '────────────────────────────────────────────────────────────',
      ' Accessing workspace:',
      ' Quick safety check: Is this a project you created or one you trust?',
      ' This folder pre-approves 3 tool permissions in .claude/settings.json.',
      ' ❯ No, continue without these permissions',
      '   Yes, I trust this folder',
      ' Enter to confirm · Esc to cancel',
    ].join('\n')
    const s = readScreen(screen, 'claude').state
    expect(s.kind === 'question' && [s.name, s.choices.map((c) => c.label)]).toEqual(['trust-rules', ['No, without those permissions', 'Yes, I trust it']])
  })
})

describe('questions read right', () => {
  it('an option description is never an extra button (the off-by-one of the AskUserQuestion menu)', () => {
    const s = read('claude-live-E1-ask.txt').state
    expect(s.kind === 'question' && s.choices.map((c) => c.label)).toEqual(['a.txt', 'b.txt'])
    // "Type something." and "Chat about this" keep their place in the menu: a tap on b.txt moves exactly once.
    if (s.kind !== 'question') throw new Error()
    expect(s.choices[1].id.endsWith(':1')).toBe(true)
    expect(s.typeIndex).toBe(2)
  })
  it('multi-select: checkboxes become marks, and the submit row is a button', () => {
    const s = read('claude-live-E2-multi.txt').state
    expect(s.kind === 'question' && [s.multi, s.choices.map((c) => c.label)]).toEqual([true, ['hi', 'hello', 'Send my answers']])
  })
  it('the steps of a plan are never buttons', () => {
    const s = read('claude-live-D2-planexit.txt').state
    expect(s.kind === 'question' && s.choices.map((c) => c.label)).toEqual(['Go ahead', 'Go ahead, ask before each edit'])
  })
  it('a permission says what and why, from the dialog itself', () => {
    const s = read('claude-live-R4-dangerous-rm.txt').state
    expect(s.kind === 'question' && [s.question, s.detail]).toEqual(['Claude wants to run a command: remove build output', 'rm -rf build dist · Dangerous rm operation on a path outside the project'])
  })
  it('Codex approvals lose their key hints', () => {
    const s = read('codex-14-command-approval.txt').state
    expect(s.kind === 'question' && [s.question, s.choices.map((c) => c.label)]).toEqual(['Codex wants to run a command', ['Allow', 'Always allow', 'Deny']])
  })
  it('Codex asking its own question (request_user_input) is a question, not an idle session', () => {
    const s = read('codex-20-request-user-input-codex-asks-you-a-ques.txt').state
    expect(s.kind === 'question' && [s.question, s.choices.map((c) => c.label)]).toEqual(['Which database should I use?', ['Postgres', 'SQLite', 'None of the above']])
  })
  it('a menu weevils does not know is still a question, with its own words, and is marked unknown', () => {
    const screen = ['────────────────────────────────────────', '  Something brand new', '  ❯ 1. Do the new thing', '    2. Leave it', '  Enter to confirm · Esc to cancel'].join('\n')
    const s = readScreen(screen, 'claude').state
    expect(s.kind === 'question' && [s.name, s.question, s.choices.map((c) => c.label)]).toEqual(['unknown', 'Something brand new', ['Do the new thing', 'Leave it']])
  })
  it('in French too', () => {
    const s = withLang('fr', () => read('claude-live-D3-bash.txt').state)
    expect(s.kind === 'question' && [s.question, s.choices.map((c) => c.label)]).toEqual(['Claude veut lancer une commande : print hi', ['Autoriser', 'Refuser']])
  })
})

describe('no false question', () => {
  it('the composer, the thread and work in progress are not questions', () => {
    expect(readScreen('● Done.\n\n❯ \n  ? for shortcuts', 'claude').state.kind).toBe('none')
    expect(readScreen('› Ask Codex to do anything\n\n  GPT-6.1-Sol default · ~/p\n  ← for agents · ? for shortcuts', 'codex').state.kind).toBe('none')
    expect(read('codex-33-working-spinner.txt').state.kind).toBe('none')
  })
  it('a menu quoted in the thread above a live composer is history', () => {
    const screen = ['● Here is what the tool printed:', '  ❯ 1. Yes', '    2. No', '  Enter to confirm · Esc to cancel', '────────────────────────────────', '❯ ', '────────────────────────────────', '  ⏵⏵ bypass permissions on'].join('\n')
    expect(readScreen(screen, 'claude').state.kind).toBe('none')
  })
  it('an old usage-limit message is forgotten once a newer prompt was sent', () => {
    const screen = ['❯ fix the login bug', '  ⎿  You’ve hit your session limit · resets 5am', '', '❯ go on', '● Sure, continuing.', '────────────────────────────────', '❯ ', '────────────────────────────────'].join('\n')
    expect(readScreen(screen, 'claude').state.kind).toBe('none')
  })
  it('the spinner counts as work on every frame, a finished turn does not', () => {
    for (const frame of ['·', '✢', '✳', '✶', '✻', '✽', '*']) expect(workingOnScreen(`${frame} Pondering… (3s · ↓ 12 tokens)`)).toBe(true)
    expect(workingOnScreen('✻ Baked for 9s · done 7:08 AM')).toBe(false)
    expect(workingOnScreen('• Working (12s • esc to interrupt)')).toBe(true)
  })
})

describe('fallbacks', () => {
  it('a stuck screen becomes one plain question with two plain answers', () => {
    const s = stuckQuestion('some unknown full-screen thing', 'codex')
    expect(s.kind === 'question' && [s.name, s.question, s.choices.map((c) => c.label), s.choices.map((c) => c.id.split(':')[1])])
      .toEqual(['unknown-stuck', 'Codex is waiting on a screen weevils doesn’t know', ['Continue', 'Go back'], ['enter', 'esc']])
  })
  it('kept unknown screens carry no home path, address, key or token', () => {
    const r = redactScreen('/home/alice/x scarville@example.org sk-ant-abcdefghijkl https://h/#k=SECRET123 abcdefghijklmnopqrstuvwxyz0123456789')
    expect(r).toBe('/home/user/x someone@example.com [key] https://h/#k=[code] [token]')
  })
  it('a screen id ignores trailing spaces and old scrollback', () => {
    expect(screenId('a  \nb')).toBe(screenId('a\nb'))
    expect(screenId(`old\n${'x\n'.repeat(40)}`)).toBe(screenId(`older\n${'x\n'.repeat(40)}`))
  })
})
