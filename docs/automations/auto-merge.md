# What merges on its own

An automation's work lands on its own branch (`auto/…`), pushed by weevils at the end of the run, and waits for the
person's go. A few kinds of change are low-risk and self-contained: for weevils' own repository, they land on main by
themselves once the checks pass (`server/auto-merge.ts`, called from `pushRun` in `server/optimizers.ts`).

## The rule

A change merges on its own when **every** file it touches belongs to a safe kind:

| kind | files |
|---|---|
| theme | the diff adds a `:root[data-theme='<id>'] {` block; then `src/**/*.css`, `src/ui/app-context.tsx` (selector), `src/i18n/bands.ts` (label), `shared/link-colors.ts` (link shades) |
| copy | `src/i18n/*.ts`, `docs/**/*.md`, `README*.md` |
| asset | **added** images, fonts, sounds under `public/`, `src/assets/`, `docs/` (no SVG: it can hold script) |
| tests | test files, alongside one of the kinds above (never alone) |

Never on its own, whatever else the change holds: `server/`, `scripts/`, `install.sh`, `package*.json`,
`.github/`, `.claude/`, `AGENTS.md`/`CLAUDE.md`, any path naming auth, secret, token, credential, password or env,
a deletion or a rename, CSS that `@import`s or loads a `url()` from outside. Any other repository than the checkout
weevils runs from never merges on its own.

## The order

1. Rebase the task branch on the current `origin/main` (a conflict aborts: the branch stays).
2. Classify the result (above).
3. Checks: `npm run typecheck`, `npm run i18n:check`, `vitest run --changed origin/main` (the tests the change touches).
4. Push fast-forward to main, never forced (main moved meanwhile: refused, the branch stays).
5. The running weevils takes it: its checkout fast-forwards (only on main and clean: someone's work is never touched)
   and the app is rebuilt. No restart: the safe kinds never change the server.
6. Only then For you says so ("new theme desert is in your selector"); the run's line records `merged`.

An automation's own posts must not claim its work is live: weevils posts that itself, at step 6.
