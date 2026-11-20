# 04 · Resume

A thread can continue on any engine. weevils always takes the best way available: the same provider session where
it is, the same provider session moved to another machine, or a handoff given to another provider. The code travels
with the thread as a checkpoint taken at the end of every turn, and the handoff is kept current so that it is already
there when something stops.

```
rung 1   same machine, same provider       claude --resume <session>              nothing moves, nothing lost
rung 2   other machine, same provider      raw → provider file, checkpoint → folder,
                                           then the same native resume            nothing lost
rung 3   other provider                    handoff.md + last exchanges word for word
                                           + checkpoint → a new provider session   the provider's hidden state is lost
```

(`rung: 0` in `leg.start` means there was nothing to resume: the first leg of a new thread.)

## A worked example

The sample thread [`add-csv-export-to-orders`](../../examples/weevbook/projects/shop-app/2026-11/01M7QDKAT85KGENVY3NP4N74YB-add-csv-export-to-orders/events.jsonl):
Claude Code reaches its usage limit in the middle of turn 2.

| seq | Event | What happened |
|---|---|---|
| 21–22 | `tool` Read, Edit | Claude Code is changing `src/orders/export.ts`. |
| 23 | `checkpoint` turn 2, `changed: 2` | The provider wrote its limit message. The laptop is alive: weevils saves the folder as it is. |
| 24 | `turn` `failed`, `reason: quota`, `effect: some` | Two steps were taken: the turn is not replayed as if nothing happened. |
| 25 | `leg.end` `quota` | |
| 26 | `handoff` `by: journal` | The handoff of turn 1 is completed without a model: "In progress" lists the two steps. |
| 27 | `turn` `assigned` → `codex:c81d2e@laptop`, `attempt: 2`, `resume: true`, `rule: provider` | |
| 28 | `leg.start` `rung: 3` | Codex receives the preface, `handoff.md` and the last exchanges. |
| 30–35 | `tool` ×5, `message` | Codex looks at `git diff` first, then finishes. |
| 36–38 | `checkpoint`, `turn` `done`, `handoff` `by: codex:c81d2e@laptop` | |

In the app: one thread, one answer, a little later than usual.

## The rungs, step by step

**Rung 1.** The provider session file is on this machine. Start the provider with its own resume
(`claude --resume <session>`, `codex resume <session>`). A change of account on the same machine is still rung 1:
the accounts share the provider session files.

**Rung 2.**

1. Take the lease ([03](03-sync-and-lease.md)). Fetch the thread ref and the checkpoint ref.
2. Find where the project lives here: a clone with the same origin, else clone it, else a folder of the same name.
3. Restore the checkpoint (below).
4. Rebuild the provider session file: the raw segments of every leg that has this `session`, in order, with the old
   folder path rewritten to the new one. Write it where the provider looks
   (`~/.claude/projects/<folder slug>/<session>.jsonl`; `~/.codex/sessions/YYYY/MM/DD/rollout-…-<session>.jsonl`).
5. Append `leg.start` with `rung: 2`, then resume natively as in rung 1.

What rung 2 does not carry: strings that redaction replaced ([02](02-weevbook.md#redaction)), and what "Not carried"
lists in the handoff.

**Rung 3.** Steps 1 to 3 of rung 2, then a new provider session whose first request is, in this order: the preface
(signed `[from:weevbook;thread:<id>]`, so that the adapter does not take it for a message of the thread), the whole
of `handoff.md`, the events after its `upTo` rendered as in `thread.md`, and the last 24 messages word for word, cut
at 20,000 characters. Rung 3 is also how a thread that came from a chat app gets its first engine.

Going back to the first provider later is rung 1 or 2 on its old provider session, with one request that
tells what happened since.

## Checkpoints

A checkpoint is a git commit of the project folder as it is on disk: committed, uncommitted and untracked files.
It is made without touching the user's index, branches or stash.

```sh
export GIT_INDEX_FILE=$(mktemp -u)        # a throwaway index; the real one is never opened
git read-tree HEAD
git add -A                                # tracked changes and untracked files; .gitignore is respected
                                          # (untracked files over 5 MiB are left out of this step)
tree=$(git write-tree); unset GIT_INDEX_FILE
commit=$(git commit-tree $tree -p HEAD -p $previous_checkpoint -m "turn 2 · <thread id>")
git update-ref refs/weevils/checkpoints/<thread id> $commit
git push <hub> refs/weevils/checkpoints/<thread id>:refs/checkpoints/<thread id>
```

| | |
|---|---|
| Ref in the project | `refs/weevils/checkpoints/<thread id>`. Not a branch: no tool lists it. |
| Ref in the hub | `refs/checkpoints/<thread id>`. Pushed to the hub only, **never to the project's own remote**. |
| Parents | First: `HEAD` at that moment (`base` in the event; it may be a commit the user has not pushed, and it travels with the checkpoint). Second: the previous checkpoint of the thread, when there is one. |
| The event | `checkpoint` with `turn`, `kind: git`, `repo` (the origin, without credentials), `commit`, `base`, `branch`, `changed` (files that differ from `base`), `skipped`. |
| Size cap | An untracked file over 5 MiB is left out and named in `skipped` (up to 20 names). Tracked files are always in. |
| Folder without git, or without a first commit | `kind: shadow`: the same commands against a private repository kept by weevils (`~/.local/share/weevils/checkpoints/<thread id>.git`) with the folder as work tree and a built-in ignore list (`node_modules`, `.venv`, `dist`, `build`, logs). |
| Too large, or a home folder | Over 200 MiB or 20,000 files after ignores, or the folder is a home folder: `kind: none` with a `reason`. The thread then resumes on that machine only ([06](06-dispatch.md)). |

**Restoring** on another machine:

1. If the folder has changes that are not this thread's previous checkpoint, or another leg is at work in it:
   restore into a git worktree of the same repository instead, on a new branch `weevils/<slug>`. Nobody's work is
   overwritten.
2. Otherwise restore in place only when `HEAD` is already `base`. An existing branch is never moved, not even
   forward: weevils does not touch the user's branches (decided with step 2; this replaces "fast-forward the
   branch"). Any other `HEAD`: the worktree of step 1. A repository weevils has just made (an empty folder, or its own
   clone) is the exception: its branch goes forward to `base`, or a branch is made there.
3. Write the checkpoint's files over the folder through a throwaway index (`git read-tree <checkpoint>`, `git
   checkout-index -a -f`), and remove the files `base` has and the checkpoint has not. Same result as `git restore
   --source=<checkpoint> --worktree -- :/`; the user's index is never written. The files are now as the engine left
   them, and `git status` shows them as changes on top of `base`.

A folder without git is restored in place when it is empty or holds only this thread's earlier state, otherwise in a
new folder beside it (`<folder>-weevils-<slug>`).

**When a checkpoint is taken** (step 2, with a hub set): when the writer reads the end of a turn (`done`, or `failed`
with an effect) within 10 minutes of it. A turn read later (a backfill, a restart long after) keeps `kind: none` as in
step 1: the folder is no longer what it was then. A checkpoint that could not be copied into the weevbook is `kind:
none` with its reason. `server/weevbook/checkpoint.ts` takes and restores them.

Not carried by a checkpoint, and therefore written in the handoff: ignored files (`.env`, `node_modules`), the
difference between staged and unstaged, stashes, running programs, local databases, environment variables.

## The handoff

`handoff.md` has a fixed shape, so that it can be checked and so that any provider reads it the same way:

```markdown
---
thread: 01M7QDKAT85KGENVY3NP4N74YB
upTo: 47
at: 2026-11-18T14:21:50Z
by: codex:c81d2e@laptop
---
# Handoff: Add CSV export to orders

## Goal            what the user wants, in their terms
## State           ### Done · ### In progress · ### Next
## Decisions       choices made and why, so they are not reopened
## Files           the files that matter
## Run and test    the commands, and their last result
## Not carried     what the next engine must start or set up again; names of variables, never values
## Open questions
```

- **Kept current (decision D3).** After every `turn` `done` of a thread active in the last 24 hours, the leg's
  engine rewrites the handoff in the background with its provider's small model, from the previous one and the
  events after `upTo`. A handoff that lost a heading is thrown away and the previous one kept. At most 12,000
  characters.
- **Without a model.** When the provider cannot be asked (it is the one that just stopped), the handoff is completed
  from the journal: "In progress" receives the request and the tool steps since `upTo`. The event says
  `by: journal`.
- **Lag.** A handoff is at most one finished turn behind. Rung 3 always adds the events after `upTo`, so a late one
  costs words, not facts.

## When a turn fails

| What stopped | How it is known | `effect` | What happens next |
|---|---|---|---|
| The provider refused before doing anything (limit, sign-in, API error on the first request) | The adapter sees the stop with no `tool` and no `assistant` event since `running`, and the folder equals the last checkpoint. | `none` | The dispatcher runs again at once. The request goes to the next engine as it was. Nothing is shown. |
| The provider stopped part-way, machine alive | The adapter sees the stop after at least one step. | `some` | A checkpoint is taken now. The dispatcher runs again; the next `assigned` has `resume: true`. |
| The machine went silent | Its lease is stolen ([03](03-sync-and-lease.md)). | `some` once `running`; `none` if it was only `assigned` | The new holder restores the last pushed checkpoint and resumes. |
| The user stopped the turn | The provider's own interruption line. | — | `checkpoint`, then `done`. A stop the user asked for is not a failure. |

- **A resumed turn is not a replay.** With `resume: true` the engine does not receive the user's message again as if
  it were new. It receives the preface: what was asked, the steps the journal recorded, where the folder stands, and
  "look before redoing anything; do not repeat a step that acts outside this folder (a deploy, a payment, an e-mail,
  a push) without checking that it did not already happen".
- **Once resumed, always resumed.** The effect of a turn is sticky: after one attempt had an effect, every later
  attempt has `resume: true` and gets the preface, even when the attempt just before failed with no effect.
- **Three failures that are the turn's own.** A turn that failed three times with reason `api` or `auth` is `held`
  with the reason `attempts`, and the app says what to do. A quota that ran out, a machine that went away or a lease
  that was lost does not count: the table bounds those (`no-room`, `no-machine`).
- **Never stuck.** A failed turn is always followed by `assigned` or `held`. A thread never waits for a new message
  to notice that its last turn did not finish.
- **Oldest first.** One turn at a time is in an engine's hands (THREAD-11). A message that arrives while a turn runs
  opens the next turn, which waits in `accepted`. The dispatcher always places the oldest waiting turn. When the
  table finds no engine, every waiting turn is held with the same reason; a turn held for `attempts` waits for the
  user and does not block the turns after it.
- **Held.** `rule` is `hold`; `reason` is a code the app turns into its sentence: `no-machine`, `no-room`,
  `not-signed-in`, `only-there` ([06](06-dispatch.md)) or `attempts`. When the table later gives another reason, the
  held turn is written again with it; when it gives an engine, the turn is assigned.
- `turn.ts` implements this section: the state machine, the retry rule (`next`) and the preface.

**What counts as an attempt** (decided with step 3). Only failures with reason `api` or `auth`. Counting every
`assigned` held about one turn in 40 in the simulator, nearly always after failures that were not the turn's doing
(`quota`, `machine-lost`), and the app then said "it stopped three times in a row" when the truth was "your accounts
ran out". With the rule above, 20,000 simulated runs (395,157 turns done) held 12 turns for `attempts`, with no
invariant broken. `turn.ts` counts them (`counted`, `COUNTED`); the attempt number in `assigned` still counts every
attempt.

## Step 3: resume on another machine

Decided with step 3. `server/weevbook/resume.ts` (`resumeThread`) implements it; `weevils weevbook resume <thread>
[--wait]` calls it. The dispatcher of step 4 starts its turns with `start.ts`, which shares its steps.

- **Only when asked**, and only with the thread's own provider. A change of provider (rung 3) is not done here.
- **The lease.** Idle, whoever holds it: taken over. Working, and its holder silent: stolen first when the rules of
  [03](03-sync-and-lease.md) allow it (`--wait` waits at most 130 s + 30 s). Working, and its holder alive: refused,
  with how long until a steal would be allowed. Working on this machine: refused.
- **The engine** comes from `dispatch.ts` on a table of two machines: this one, alive, signed in on the thread's
  provider, its quota taken as 0 % (no reading exists before step 4), and the old one, silent. The rows give
  `machine` (rung 2) for another machine, `stay` or `account` (rung 1) for the same one. `hold` (`only-there` for a
  last checkpoint of `kind: none`) is reported and nothing is written. A turn held for `attempts` is refused.
- **The folder**: found or cloned as in rung 2 (`place` of `server/bring.ts`), then the last checkpoint of the thread
  that the hub has is restored (above). With no checkpoint on the hub, the folder is used as found and the preface
  says that steps may be missing from it.
- **One push**: `leg.end` (`moved`, when the open leg is another machine's), `assigned` (next attempt, `resume` from
  the sticky effect, rule and reason from the table), `leg.start` (rung, the epoch of the lease after the push),
  `running`, with the lease `working`. Rejected: the hub's version is taken back and nothing happened.
- **The provider session** (rung 2): rebuilt from the raw segments of every leg with this session, each leg's folder
  rewritten to the new one. It is recorded in `weevbook-sessions.jsonl` before the file is written (the writer must
  never take it for a new thread), with the lines of the earlier legs as `base`: only what follows is the new leg's
  raw. A file already there is kept beside it (`.before-weevbook`).
- **The first request**: the preface when an attempt of the turn had an effect (RESUME-8), the user's message
  otherwise; never both. The local weevilsd starts the engine (`POST /api/sessions/<id>/send`, as the app does). If
  it cannot: `failed` (`api`, effect `none`), `leg.end` (`error`), idle.
- **No waiting turn**: the leg moves here (`leg.end`, `leg.start`), nothing is started; the user goes on from the app.
- **In the end-to-end test** (`hub.e2e.test.ts`): the steal 90 s after the last renewal, then the resume (restore,
  rebuild, push, start) in about 0.3 s.
- **Known limit**: the adapter of the resumed leg reads that leg's events only, so its own record of an earlier
  effect starts at the new leg; `turn.ts` and the journal (THREAD-10) still keep the effect sticky.

## Invariants

To be tested with two machines at step 3, and by the simulator at step 4.

- **RESUME-1** A checkpoint never changes the project's index, `HEAD`, branches or stash: `git status` and
  `git branch -a` print the same before and after.
- **RESUME-2** No checkpoint ref is ever pushed to a remote other than the hub.
- **RESUME-3** After a restore, every file of the checkpoint's tree is on disk with the same content, and no other
  tracked file is.
- **RESUME-4** A restore never moves an existing branch to a commit that is not its descendant, and never
  overwrites uncommitted work that is not the thread's own previous checkpoint.
- **RESUME-5** After rung 2, the rebuilt provider session file equals the raw segments in order, with only the
  folder path changed.
- **RESUME-6** The rung chosen is the lowest one that is possible for the engine chosen.
- **RESUME-7** `handoff.md` always has its front matter and its seven headings.
- **RESUME-8** The user's message of a turn is given to an engine as a new request only while no attempt of that
  turn has had an effect. After an effect, the engine gets the preface instead.
- **RESUME-9** Every `failed` turn is followed by `assigned` or `held` for the same turn.

## Failure cases

| What happens | Result |
|---|---|
| The project cannot be found or cloned on the other machine | That engine is not a candidate ([06](06-dispatch.md)); with none left the turn is `held`. |
| The last checkpoint was never pushed (the machine died first) | The new engine starts from the last pushed one and is told which steps of the journal are not in the folder. |
| The provider refuses the rebuilt provider session file (its format changed) | Rung 2 fails with `effect: none`; the same engine is tried on rung 3. |
| The folder on the other machine has someone's uncommitted work | The restore goes to a separate worktree. |
| The handoff is missing or broken | It is rebuilt from the journal (`by: journal`) before rung 3. |
| A checkpoint is `kind: none` | The thread is offered to engines of that machine only. If the machine is off, the turn is `held`: "this one can only continue on laptop". |

## What exists today

- [`server/weevbook/turn.ts`](../../server/weevbook/turn.ts): the turn as a pure reducer (`applyTurn`, `turnsOf`),
  the retry rule (`next`, `assign`, `holdAll`, `stolen`) and the signed preface (`preface`). The hub sync uses it for
  steals, `resume.ts` for the attempt and the preface.
- [`server/weevbook/checkpoint.ts`](../../server/weevbook/checkpoint.ts) (step 2): checkpoints `git`, `shadow` and
  `none`, and restores, as above. `checkpoint.test.ts`: a repository with staged, unstaged, deleted, untracked and
  ignored files (RESUME-1), the 5 MiB cap, a folder without git, a home folder, restores in place, in a worktree, in a
  new repository, beside (RESUME-3, RESUME-4).
- [`server/weevbook/resume.ts`](../../server/weevbook/resume.ts) (step 3): "Step 3" above. `hub.e2e.test.ts` runs it
  between two machines (RESUME-5, RESUME-8, RESUME-9).
- `server/bring.ts` does half of rung 2 by hand: it finds or clones the project (`place`), rewrites the folder path
  in every line (`rewritePaths`) and writes the file where the provider looks (`arrive`). It is started by the user,
  moves whole files in one go, and does not move the code's state.
- `server/claude-accounts.ts` is rung 1 across accounts: each added account is a config folder whose session files
  are links to the same place, so `claude --resume` works under any of them. Linux only, off unless
  `WEEVILS_CLAUDE_ACCOUNTS=1`, and one account is "active" for the whole machine.
- `server/relay.ts` is a rung 3 for one case: Claude at its usage limit. From 90 % Codex writes a plan per working
  session; at 97 % sessions are told to stop; the user approves each plan (or sets "automatic"). The plan is written
  when the limit is near, not kept current, and the user sees the whole mechanism.
- `server/return-relay.ts` goes the other way without a model: the first request plus the last 24 messages, cut at
  20,000 characters. Rung 3 keeps those two numbers.
- [`server/weevbook/handoff.ts`](../../server/weevbook/handoff.ts) (step 4): the handoff from the journal
  (`journalHandoff`), its check (front matter, the seven headings in order, 12,000 characters), its rewrite by a small
  model (`nextHandoff`, falling back to the journal's), and the first request of rung 3 (`firstRequest`): the signed
  preface, the handoff, the events after `upTo`, the last 24 messages within 20,000 characters, the request.
  [`start.ts`](../../server/weevbook/start.ts) runs rungs 0 to 3 for the dispatcher ([06](06-dispatch.md#step-4-the-dispatcher-in-weevilsd)).
- The state of the code is saved only with a hub set (step 2).

## Not in v1

- Submodules and Git LFS content inside checkpoints (a submodule is recorded as its commit only).
- Carrying ignored files such as `.env`. The handoff names them.
- Restarting what was running (dev servers, watchers). The handoff names them too.
- Resuming a chat natively: a thread that came from a chat always continues on rung 3, or in the chat itself
  through `read_thread` ([05](05-connector.md)).
