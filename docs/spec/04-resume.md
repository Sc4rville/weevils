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
2. Otherwise move to `base`: fast-forward the branch when that is possible, else use the worktree of step 1. An
   existing branch is never moved backwards or sideways.
3. `git restore --source=<checkpoint> --worktree -- :/`. The files are now as the engine left them, and `git status`
   shows them as changes on top of `base`.

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
| The machine went silent | Its lease is stolen ([03](03-sync-and-lease.md)). | `some` | The new holder restores the last pushed checkpoint and resumes. |
| The user stopped the turn | The provider's own interruption line. | — | `checkpoint`, then `done`. A stop the user asked for is not a failure. |

- **A resumed turn is not a replay.** With `resume: true` the engine does not receive the user's message again as if
  it were new. It receives the preface: what was asked, the steps the journal recorded, where the folder stands, and
  "look before redoing anything; do not repeat a step that acts outside this folder (a deploy, a payment, an e-mail,
  a push) without checking that it did not already happen".
- **Three attempts.** A turn is assigned at most three times. After that it is `held` with the reason, and the app
  says what to do.
- **Never stuck.** A failed turn is always followed by `assigned` or `held`. A thread never waits for a new message
  to notice that its last turn did not finish.

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
- Nothing saves the state of the code today.

## Not in v1

- Submodules and Git LFS content inside checkpoints (a submodule is recorded as its commit only).
- Carrying ignored files such as `.env`. The handoff names them.
- Restarting what was running (dev servers, watchers). The handoff names them too.
- Resuming a chat natively: a thread that came from a chat always continues on rung 3, or in the chat itself
  through `read_thread` ([05](05-connector.md)).
