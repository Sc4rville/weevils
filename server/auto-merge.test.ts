import { describe, expect, it, vi } from 'vitest'
import { addedThemes, autoMerge, classify, reserved, touchesServer, updateLive } from './auto-merge.ts'
import { landingWhy, scopePrompt } from './optimizers.ts'

const M = (path: string) => ({ status: 'M', path })
const A = (path: string) => ({ status: 'A', path })
const R = (path: string, added: number) => ({ status: 'M', path, added })
const theme = [":root[data-theme='desert'] {", '  --ink: #1f120a;', '}', ":root[data-theme='synthwave'] {"]

describe('what merges on its own', () => {
  it('a new theme with its selector entry, labels, link colours, tests and record', () => {
    const v = classify([M('src/styles.css'), M('src/ui/foryou.css'), M('src/ui/app-context.tsx'), M('src/i18n/bands.ts'), M('shared/link-colors.ts'), M('test/theme-contrast.test.ts'), M('src/ui/voice.test.tsx'), M('docs/themes.md')], theme)
    expect(v).toEqual({ safe: true, kinds: ['theme', 'copy'], themes: ['desert', 'synthwave'] })
  })
  it('copy: catalog strings and docs', () => {
    expect(classify([M('src/i18n/bands.ts'), M('docs/foryou.md'), M('README.md')], [])).toEqual({ safe: true, kinds: ['copy'], themes: [] })
  })
  it('an added image', () => {
    expect(classify([A('public/icons/new.png')], [])).toMatchObject({ safe: true, kinds: ['asset'] })
  })
  it('a pure cleanup: code only removed (server included), whole dead files deleted, tests fixed', () => {
    const v = classify([R('server/foryou-curator.ts', 0), R('shared/foryou.ts', 0), R('src/ui/format.ts', 0), { status: 'D', path: 'src/ui/old.tsx' }, R('server/background.test.ts', 2)], [])
    expect(v).toEqual({ safe: true, kinds: ['cleanup'], themes: [] })
    expect(touchesServer([R('server/foryou-curator.ts', 0)])).toBe(true)
    expect(touchesServer([R('src/ui/format.ts', 0), R('server/background.test.ts', 2)])).toBe(false)
  })
  it('reads the themes a CSS diff adds', () => {
    expect(addedThemes(theme)).toEqual(['desert', 'synthwave'])
    expect(addedThemes(["[data-theme='dark'] .hint,"])).toEqual([])
  })
})

describe('what stays a branch awaiting approval', () => {
  it.each([
    ['server logic', [M('server/optimizers.ts'), M('src/styles.css')]],
    ['an added line in server code, even among removals', [R('server/foryou-curator.ts', 0), R('server/core.ts', 1)]],
    ['a removal from the installer', [R('install.sh', 0)]],
    ['a removal from a sign-in file', [R('server/claude-login.ts', 0)]],
    ['a removal from the agents\' instructions', [R('server/orchestrator.en.md', 0)]],
    ['a removal of unknown size', [M('server/core.ts')]],
    ['install', [M('install.sh')]],
    ['dependencies', [M('package.json')]],
    ['scripts', [A('scripts/x.mjs')]],
    ['agent instructions', [M('AGENTS.md')]],
    ['auth', [M('src/ui/auth-gate.tsx')]],
    ['a deletion', [{ status: 'D', path: 'docs/old.md' }]],
    ['an asset changed rather than added', [M('public/icons/a.png')]],
    ['an SVG (can hold script)', [A('public/icons/a.svg')]],
    ['any other front-end code', [M('src/ui/bands.tsx'), M('src/styles.css')]],
    ['tests alone', [M('test/logo.test.tsx')]],
  ])('%s', (_, changes) => {
    expect(classify(changes, theme).safe).toBe(false)
  })
  it('app logic when no theme is added', () => {
    expect(classify([M('src/ui/app-context.tsx')], []).safe).toBe(false)
    expect(classify([M('src/styles.css'), M('shared/link-colors.ts')], ["[data-theme='dark'] .hint {"]).safe).toBe(false)
  })
  it('CSS that loads from outside', () => {
    expect(classify([M('src/styles.css'), M('src/ui/app-context.tsx')], [...theme, "  background: url('https://x.example/a.png');"]).safe).toBe(false)
    expect(classify([M('src/styles.css')], ["@import 'https://x.example/a.css';", ...theme]).safe).toBe(false)
  })
})

/** A fake git: answers by command, records every call. */
function fakeGit(answers: Record<string, string | null>, calls: string[][] = []) {
  return {
    calls,
    git: async (dir: string, args: string[]) => {
      calls.push([dir, ...args])
      const key = Object.keys(answers).find((k) => args.join(' ').startsWith(k))
      return key === undefined ? '' : answers[key]
    },
  }
}
const ok = {
  'remote get-url origin': 'https://github.com/x/weevils.git',
  'status --porcelain': '',
  'diff --name-status': 'M\tsrc/styles.css\nM\tsrc/ui/app-context.tsx\nM\tdocs/themes.md',
  'diff -U0': "+++ b/src/styles.css\n+:root[data-theme='desert'] {\n+  --ink: #000;",
  'rev-parse HEAD': 'abc1234def',
}

describe('autoMerge', () => {
  it('rebases, checks, then pushes fast-forward to main (never forced)', async () => {
    const { git, calls } = fakeGit(ok)
    const runs: string[] = []
    const r = await autoMerge('/wt', '/app', undefined, git, async (_d, cmd, args) => (runs.push([cmd, ...args].join(' ')), true))
    expect(r).toEqual({ merged: true, commit: 'abc1234def', kinds: ['theme', 'copy'], themes: ['desert'] })
    expect(calls.map((c) => c.slice(1).join(' '))).toContain('rebase -q origin/main')
    const push = calls.find((c) => c[1] === 'push')!
    // main lives where it is fetched from, even when the checkout's pushurl points elsewhere
    expect(push.slice(1)).toEqual(['push', '-q', 'https://github.com/x/weevils.git', 'HEAD:refs/heads/main'])
    expect(push.join(' ')).not.toMatch(/-f\b|--force/)
    expect(runs).toEqual(['npm run typecheck', 'npm run i18n:check', 'npx vitest run --retry 2 --changed origin/main --passWithNoTests'])
  })
  it('the checks run inside the run’s own jail and environment (they execute what the automation wrote)', async () => {
    const { git } = fakeGit(ok)
    const runs: string[] = []
    const box = { wrap: ['bwrap', '--dev-bind', '/', '/', '--'], set: { WEEVILS_SCOPE: 'automation' }, unset: ['GH_TOKEN'] }
    await autoMerge('/wt', '/app', box, git, async (_d, cmd, args) => (runs.push([cmd, ...args].join(' ')), true))
    expect(runs).toEqual([
      'bwrap --dev-bind / / -- env -u GH_TOKEN WEEVILS_SCOPE=automation npm run typecheck',
      'bwrap --dev-bind / / -- env -u GH_TOKEN WEEVILS_SCOPE=automation npm run i18n:check',
      'bwrap --dev-bind / / -- env -u GH_TOKEN WEEVILS_SCOPE=automation npx vitest run --retry 2 --changed origin/main --passWithNoTests',
    ])
  })
  it('red checks: no push', async () => {
    const { git, calls } = fakeGit(ok)
    const r = await autoMerge('/wt', '/app', undefined, git, async (_d, _c, args) => !args.includes('vitest'))
    expect(r).toEqual({ merged: false, why: 'tests failed' })
    expect(calls.some((c) => c[1] === 'push')).toBe(false)
  })
  it('a conflict with main: the rebase is aborted, the branch stays', async () => {
    const { git, calls } = fakeGit({ ...ok, 'rebase -q': null })
    expect(await autoMerge('/wt', '/app', undefined, git, async () => true)).toEqual({ merged: false, why: 'conflicts with main' })
    expect(calls.some((c) => c.slice(1).join(' ') === 'rebase --abort')).toBe(true)
  })
  it('server changes: no checks run, no push', async () => {
    const { git, calls } = fakeGit({ ...ok, 'diff --name-status': 'M\tsrc/styles.css\nM\tserver/core.ts' })
    let ran = false
    const r = await autoMerge('/wt', '/app', undefined, git, async () => (ran = true))
    expect(r.merged).toBe(false)
    expect(ran).toBe(false)
    expect(calls.some((c) => c[1] === 'push')).toBe(false)
  })
  it('a run’s leftovers (untracked screenshots, scratch files) never hold it back; tracked edits left uncommitted do', async () => {
    const { git, calls } = fakeGit(ok)
    expect((await autoMerge('/wt', '/app', undefined, git, async () => true)).merged).toBe(true)
    expect(calls.find((c) => c[1] === 'status')!.slice(1)).toEqual(['status', '--porcelain', '--untracked-files=no'])
    const dirty = fakeGit({ ...ok, 'status --porcelain': ' M src/styles.css' })
    expect(await autoMerge('/wt', '/app', undefined, dirty.git, async () => true)).toEqual({ merged: false, why: 'uncommitted changes' })
    expect(dirty.calls.some((c) => c[1] === 'push')).toBe(false)
  })
  it('another repository never merges here', async () => {
    const calls: string[][] = []
    const git = async (dir: string, args: string[]) => (calls.push(args), dir === '/app' ? 'https://github.com/x/weevils.git' : 'https://github.com/x/other.git')
    expect(await autoMerge('/wt', '/app', undefined, git, async () => true)).toEqual({ merged: false, why: 'not weevils' })
    expect(calls.some((c) => c[0] === 'rebase' || c[0] === 'push')).toBe(false)
  })
})

describe('updateLive', () => {
  it('fast-forwards a clean checkout on main, then rebuilds the app', async () => {
    const { git, calls } = fakeGit({ 'symbolic-ref': 'main', status: '' })
    const runs: string[] = []
    expect(await updateLive('/app', 'abc', git, async (_d, cmd, args) => (runs.push([cmd, ...args].join(' ')), true))).toBe(true)
    expect(calls.map((c) => c.slice(1).join(' '))).toContain('merge -q --ff-only abc')
    expect(runs).toEqual(['npx vite build'])
  })
  it('rebuilds the default app too, so a landed theme shows in it', async () => {
    const { git } = fakeGit({ 'symbolic-ref': 'main', status: '' })
    const runs: string[] = []
    const run = async (_d: string, cmd: string, args: string[]) => (runs.push([cmd, ...args].join(' ')), true)
    expect(await updateLive('/app', 'abc', git, run, undefined, (p) => p === '/app/next/vite.config.ts')).toBe(true)
    expect(runs).toEqual(['npx vite build', 'npx vite build -c next/vite.config.ts'])
    // A build of the default app that fails: the update is not called done, and nothing restarts.
    const restart = vi.fn()
    expect(await updateLive('/app', 'abc', git, async (_d, _c, args) => !args.includes('-c'), restart, () => true)).toBe(false)
    expect(restart).not.toHaveBeenCalled()
  })
  it.each([
    ['on another branch', { 'symbolic-ref': 'fix/x', status: '' }],
    ['with someone\'s uncommitted work', { 'symbolic-ref': 'main', status: ' M src/App.tsx' }],
    ['when main does not fast-forward', { 'symbolic-ref': 'main', status: '', 'merge -q': null }],
  ])('leaves the checkout alone %s', async (_, answers) => {
    const { git } = fakeGit(answers)
    let built = false
    expect(await updateLive('/app', 'abc', git, async () => (built = true))).toBe(false)
    expect(built).toBe(false)
  })
})

describe('an automation\'s own job lands on its own', () => {
  const base = { 'remote get-url': 'git@github.com:me/weevils.git', status: '', 'diff --name-status': 'M\tserver/core.ts\nM\tHYGIENE.md\nM\tknip.json', 'diff --numstat': '3\t1\tserver/core.ts\n22\t1\tHYGIENE.md\n1\t0\tknip.json', 'diff -U0': '', 'log --format': 'chore(hygiene): dead code', 'rev-parse': 'c0ffee' }
  it('in scope: lands after the whole suite, and asks for a restart since server code changed', async () => {
    const { git } = fakeGit(base)
    const runs: string[] = []
    const seen: string[] = []
    const r = await autoMerge('/wt', '/app', undefined, git, async (_d, cmd, args) => (runs.push([cmd, ...args].join(' ')), true), async (c) => (seen.push(c.files, c.commits), { inScope: true, why: '' }))
    expect(r).toEqual({ merged: true, commit: 'c0ffee', kinds: ['scope'], themes: [], restart: true })
    expect(runs.at(-1)).toBe('npx vitest run --retry 2')
    expect(seen[0]).toContain('M server/core.ts (+3)')
    expect(seen[1]).toBe('chore(hygiene): dead code')
  })
  it('out of scope: waits, with the judge\'s plain sentence for the card', async () => {
    const { git, calls } = fakeGit(base)
    const r = await autoMerge('/wt', '/app', undefined, git, async () => true, async () => ({ inScope: false, why: 'It adds a new settings page, not a cleanup.' }))
    expect(r).toEqual({ merged: false, why: 'scope:It adds a new settings page, not a cleanup.' })
    expect(calls.some((c) => c[1] === 'push')).toBe(false)
    expect(landingWhy(r.merged ? '' : r.why)).toBe('It adds a new settings page, not a cleanup.')
  })
  it('keys and passwords, and the agents\' instructions, stay the person\'s call: the judge is not even asked', async () => {
    const { git } = fakeGit({ ...base, 'diff --name-status': 'M\tserver/device-tokens.ts', 'diff --numstat': '0\t3\tserver/device-tokens.ts' })
    const judge = vi.fn(async () => ({ inScope: true, why: '' }))
    const r = await autoMerge('/wt', '/app', undefined, git, async () => true, judge)
    expect(r).toEqual({ merged: false, why: 'review:security:server/device-tokens.ts' })
    expect(judge).not.toHaveBeenCalled()
    expect(reserved([M('CLAUDE.md')])).toBe('review:instructions:CLAUDE.md')
  })
  it('no answer from the judge: the change waits', async () => {
    const { git } = fakeGit(base)
    expect(await autoMerge('/wt', '/app', undefined, git, async () => true, async () => null)).toEqual({ merged: false, why: 'scope unknown' })
  })
  it('the scope question names the job, the change, the language, and asks for a scope only when none is stored', () => {
    const q = scopePrompt('Repo Hygienist: clean the repo', true, { files: 'M server/core.ts (+0)', commits: 'dead code' }, 'English')
    expect(q).toContain('Repo Hygienist: clean the repo')
    expect(q).toContain('M server/core.ts (+0)')
    expect(q).toContain('scope: one plain sentence in English')
    expect(scopePrompt('x', false, { files: '', commits: '' }, 'English')).not.toContain('scope: one plain sentence')
  })
  it('the running weevils restarts after a server change, only once the app is rebuilt', async () => {
    const restart = vi.fn()
    const { git } = fakeGit({ 'symbolic-ref': 'main', status: '' })
    expect(await updateLive('/app', 'c0ffee', git, async () => true, restart)).toBe(true)
    expect(restart).toHaveBeenCalledTimes(1)
    const failed = vi.fn()
    expect(await updateLive('/app', 'c0ffee', git, async () => false, failed)).toBe(false)
    expect(failed).not.toHaveBeenCalled()
  })
})
