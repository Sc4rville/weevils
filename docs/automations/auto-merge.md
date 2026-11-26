# What merges on its own

An automation's work lands on its own branch (`auto/…`), pushed by weevils at the end of the run, and waits for the
person's go. A few kinds of change are low-risk and self-contained: for weevils' own repository, they land on main by
themselves once the checks pass (`server/auto-merge.ts`, called from `pushRun` in `server/optimizers.ts`).

## The rule

An automation the person set up is their standing authorization for its own job. Its job is stored with it in one
plain sentence (`Optimizer.scope`, written once from what the person set it up for, by the model they run, Claude or
Codex). A run's work lands on main by itself once the checks pass when:

- every file it touches belongs to a safe kind (no question asked), or
- it stays inside its automation's job, whatever folder it touches, server code included (`ScopeJudge`: one short
  model call that reads the job, the changed files with their added lines, and the commit subjects).

| kind | files |
|---|---|
| theme | the diff adds a `:root[data-theme='<id>'] {` block; then `src/**/*.css`, `src/ui/app-context.tsx` (selector), `src/i18n/bands.ts` (label), `shared/link-colors.ts` (link shades) |
| copy | `src/i18n/*.ts`, `docs/**/*.md`, `README*.md` |
| asset | **added** images, fonts, sounds under `public/`, `src/assets/`, `docs/` (no SVG: it can hold script) |
| cleanup | code under `src/`, `server/`, `shared/` the change only removes lines from (none added) or deletes whole |
| tests | test files, alongside one of the kinds above (never alone) |

Stays the person's call everywhere, in scope or not: files holding keys or passwords (secret, credential, password,
token, `.env`) and the instructions agents read (`AGENTS.md`, `CLAUDE.md`, `.claude/`, weevboss's prompt). Also
reserved, and never done by an automation on its own: spending money, publishing outside, deleting work that exists
nowhere else (a branch with unmerged commits). Any other repository than the checkout weevils runs from never merges
on its own.

## The order

1. Rebase the task branch on the current `origin/main` (a conflict aborts: the branch stays). Tracked files left
   uncommitted stop it; untracked leftovers (a run's screenshots, scratch files) do not, and never land.
2. Classify the result (above).
3. Checks: `npm run typecheck`, `npm run i18n:check`, `vitest run --changed origin/main` (the tests the change touches;
   the whole suite for a cleanup, in-scope work or any server change),
   **inside the run's own jail and environment** (bwrap, guardEnv): they execute what the automation wrote (its tests,
   its node_modules' binaries), never with more rights than the run had.
4. Push fast-forward to main, never forced, to the repository main is fetched from (`git remote get-url origin`: a
   checkout may point its pushes elsewhere on purpose). main moved meanwhile: refused, the branch stays.
5. The running weevils takes it: its checkout fast-forwards (only on main and clean: someone's work is never touched)
   and the app is rebuilt (the classic one and the default one, `next/`); when server code changed, weevils restarts
   the way an update does (`weevils-service restart`: agent sessions live in tmux and go on).
6. The run's line records `merged`. A new theme gets one line in For you ("new theme desert is in your selector");
   the automation's ordinary work (a cleanup, in-scope work) lands without a card.

An automation's own posts must not claim its work is live: weevils posts that itself, at step 6.

## What did not land is handed over, never stranded

A run whose work did not merge by itself (it goes beyond its automation's job, or touches what stays the person's;
its checks failed; main moved; another repository) still has its branch pushed (when the push is refused, the work
stays in the run's worktree), and For you gets one plain line
saying why (the judge's own sentence when it went beyond the job), « "<title>" is waiting
for your OK », with a **Land it** button (`optimizers.ts offerLanding`, op `land:<session>`). The person's tap sends
the run's own session a brief to land it (rebase, checks, merge into main, update the running weevils), as the person.

## The person takes over a run's session

A session an automation run started stays in the run's jail for every caller but the person (`core.ts sendOne`,
`Optimizers.autoSession`). A message whose origin is the person's (`RequestOrigin 'user'`, set by the route that
received it, never read from the words: the app on a signed-in device that is not a script, a For you tap, or weevboss
relaying the person with `weevils send … --for-user` during a turn the person started) takes it over:

- the jailed process is closed and the **same conversation** resumes as an ordinary session (no jail, no automation
  deny list or environment), with a hidden note telling the agent it now has an ordinary session's rights: edit the
  app, merge into main after the tests, update the running weevils, under the repository's usual rules;
- a run still going ends « continued by you »; nothing is merged or pushed behind that session any more;
- the run keeps its ids; its line records `handedOver`; the session is no longer counted as the automation's.

Anyone else (an agent, weevboss on its own, an unsigned caller) reaches such a session only inside its jail: a live
process gets the message, a closed one is refused in plain words and never resumed outside the jail (before this, it
was, for any sender).
