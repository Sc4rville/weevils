import { describe, expect, it } from 'vitest'
import { addedThemes, autoMerge, classify, updateLive } from './auto-merge.ts'

const M = (path: string) => ({ status: 'M', path })
const A = (path: string) => ({ status: 'A', path })
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
  it('reads the themes a CSS diff adds', () => {
    expect(addedThemes(theme)).toEqual(['desert', 'synthwave'])
    expect(addedThemes(["[data-theme='dark'] .hint,"])).toEqual([])
  })
})

describe('what stays a branch awaiting approval', () => {
  it.each([
    ['server logic', [M('server/optimizers.ts'), M('src/styles.css')]],
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
    const r = await autoMerge('/wt', '/app', git, async (_d, cmd, args) => (runs.push([cmd, ...args].join(' ')), true))
    expect(r).toEqual({ merged: true, commit: 'abc1234def', kinds: ['theme', 'copy'], themes: ['desert'] })
    expect(calls.map((c) => c.slice(1).join(' '))).toContain('rebase -q origin/main')
    const push = calls.find((c) => c[1] === 'push')!
    expect(push.slice(1)).toEqual(['push', '-q', 'origin', 'HEAD:refs/heads/main'])
    expect(push.join(' ')).not.toMatch(/-f\b|--force/)
    expect(runs).toEqual(['npm run typecheck', 'npm run i18n:check', 'npx vitest run --changed origin/main --passWithNoTests'])
  })
  it('red checks: no push', async () => {
    const { git, calls } = fakeGit(ok)
    const r = await autoMerge('/wt', '/app', git, async (_d, _c, args) => !args.includes('vitest'))
    expect(r).toEqual({ merged: false, why: 'tests failed' })
    expect(calls.some((c) => c[1] === 'push')).toBe(false)
  })
  it('a conflict with main: the rebase is aborted, the branch stays', async () => {
    const { git, calls } = fakeGit({ ...ok, 'rebase -q': null })
    expect(await autoMerge('/wt', '/app', git, async () => true)).toEqual({ merged: false, why: 'conflicts with main' })
    expect(calls.some((c) => c.slice(1).join(' ') === 'rebase --abort')).toBe(true)
  })
  it('server changes: no checks run, no push', async () => {
    const { git, calls } = fakeGit({ ...ok, 'diff --name-status': 'M\tsrc/styles.css\nM\tserver/core.ts' })
    let ran = false
    const r = await autoMerge('/wt', '/app', git, async () => (ran = true))
    expect(r.merged).toBe(false)
    expect(ran).toBe(false)
    expect(calls.some((c) => c[1] === 'push')).toBe(false)
  })
  it('another repository never merges here', async () => {
    const calls: string[][] = []
    const git = async (dir: string, args: string[]) => (calls.push(args), dir === '/app' ? 'https://github.com/x/weevils.git' : 'https://github.com/x/other.git')
    expect(await autoMerge('/wt', '/app', git, async () => true)).toEqual({ merged: false, why: 'not weevils' })
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
