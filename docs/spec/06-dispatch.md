# 06 · Dispatch

When a message arrives, the dispatcher decides which thread it belongs to and which engine takes the turn. It is
plain code and a table: no model is called, the same inputs always give the same answer, and every decision is
written in the journal with the facts it used. The user chooses nothing and sees nothing, except when no engine at
all can work.

```mermaid
flowchart TD
  m[message] --> t{thread known?}
  t -- no --> n[new thread, filed by rule]
  t -- yes --> s{its engine alive<br/>and has room?}
  n --> c
  s -- yes --> stay[stay · rung 1]
  s -- no --> c{another account,<br/>same machine and provider?}
  c -- yes --> acc[account · rung 1]
  c -- no --> o{another machine,<br/>same provider, has the project?}
  o -- yes --> mach[machine · rung 2]
  o -- no --> p{another provider<br/>with room?}
  p -- yes --> prov[provider · rung 3]
  p -- no --> hold[hold: one sentence, one action]
```

## A worked example

The reference scenario: a phone, a laptop and a server; three Claude accounts and one Codex account; several threads
at work. At 13:53 the thread "Add CSV export to orders" loses its engine mid-turn (its account reaches the limit).
The engine table then reads:

| Engine | Signed in | 5 h | Week | Reserved | Seen | Threads at work |
|---|---|---|---|---|---|---|
| `claude:a3f9c1@laptop` | yes | 100 %, resets 17:00 | 41 % | 0 | 13:53:40 | — |
| `claude:a3f9c1@server` | yes | 100 % (same account) | 41 % | 0 | 13:53:38 | — |
| `claude:7b20d4@server` | yes | 64 % | 88 % | 30 | 13:53:38 | 3 |
| `claude:e91f55@laptop` | **no** (signed out) | — | — | — | 13:53:40 | — |
| `codex:c81d2e@laptop` | yes | 8 % | 15 % | 0 | 13:53:40 | — |

Row by row of the decision table: **stay** fails (a3f9c1 is at its limit). **account** fails: on the laptop the only
other Claude account is signed out. **machine** fails: on the server, a3f9c1 is the same exhausted account, and
7b20d4 is at 64 + 30 reserved = 94 %, above the 85 % a thread needs to enter. **provider** matches. The journal gets:

```json
{"v":1,"seq":27,"id":"…","at":"2026-11-18T13:53:46Z","leg":null,"type":"turn","turn":2,"state":"assigned","engine":"codex:c81d2e@laptop","attempt":2,"resume":true,"rule":"provider","reason":"claude a3f9c1 is at its 5-hour limit until 17:00 UTC; no other claude engine has room; codex c81d2e is at 8 %"}
```

At 14:20 the next message of that thread arrives. Claude a3f9c1 is still at its limit: **stay** on Codex. At 17:05
the window has reset, but **stay** still matches first: the thread keeps the engine that works.

## Which thread

1. The message names its thread (sent from an open thread in the app, or `thread` in a connector call): that one.
2. A connector call with a `conversation` whose keys are already in a journal: that thread ([05](05-connector.md)).
3. Otherwise a new thread. Its project is, in this order: the project of the folder it was started in; a project
   or repository name that appears in the text (the rule of `server/classify.ts`); none (`_unsorted`).

Filing by a model may happen later, in the background, and writes a `meta` event. It is never on the path of a
message.

## The engine table

Each machine publishes what it knows about itself in `engines.json`, the single file of `refs/engines/<machine>`
([03](03-sync-and-lease.md)). The table is the union of these files.

| Field | Meaning |
|---|---|
| `machine`, `seen` | The machine id and when it last wrote this file. It rewrites it on every change and at least every 60 s. |
| `projects` | The repositories present on the machine, by origin without credentials, and folders without git by name. |
| `engines[].engine` | `<provider>:<account>@<machine>`. |
| `engines[].signedIn` | Whether that account is signed in **on this machine**. Sign-ins never travel; an account is an engine only where it is signed in. |
| `engines[].quota` | `readAt`, and for the 5-hour and weekly windows: `used` (percent) and `resetsAt`. Quota belongs to the account: two engines of one account show the same figures. |
| `engines[].threads` | The threads this engine holds a `working` lease for. |

The dispatcher runs on the machine that serves the app (one per install). It adds two things of its own:

- **Alive**: `seen` is less than 180 s old, or the machine answers the dispatcher directly. A direct call that
  fails after the last `seen` makes the machine not alive until it writes `engines.json` again.
- **Ages by the dispatcher's own clock.** The age of `seen` and of a quota reading is the time since the dispatcher
  first read that version of `engines.json` (or made the reading itself), on its own clock, as for leases
  ([03](03-sync-and-lease.md)). `seen` is written by the machine's clock: compared with the dispatcher's, a laptop
  four minutes ahead stayed "alive" for seven minutes after it went away, and the failed direct calls, older than its
  `seen`, did not count. The simulator found it. After a restart the dispatcher reads every file again as of then.
  `resetsAt` is the provider's own time and is used as it is.
- **Reservations**: a ledger kept by the dispatcher, per account. Assigning a turn reserves 10 points of the 5-hour
  window for that thread on that account (20 when the engine must reread a long thread: any change of account, and a
  new thread that already has messages). The reservation ends when the quota is read again more than a minute after
  it was made, or when the turn ends (done, failed or held).
- **Reservations never pass 100 %.** A reservation is cut to what is left of the window: 100 − `used` − the
  account's reservations. Without the cut, a thread that stays at 96 % would reserve up to 106 % (DISP-6). They count
  on the 5-hour window only; the week is read as it is.

An account **has room** when, for both windows, `used` + its reservations is under the threshold of the row. A quota
reading older than 5 minutes is read again before the table is used. "The most room" is the lowest of the busier
window: `max(5-hour + reservations, week)`.

## The decision table

First matching row wins. `E` is the engine of the thread's last leg.

| Rule | Condition | Engine chosen | Rung |
|---|---|---|---|
| `back` | Not a retry; `E`'s provider is not the thread's first; the thread finished at least **2** turns since it last changed provider; an engine of the first provider is alive, has the project, and its account is under **50 %** on both windows. | the engine of the first provider's last leg; else the same account; else the most room | 1 or 2 if that provider's session exists (same machine, other machine), else 3 |
| `stay` | `E` is alive, signed in, and its account is under **97 %**. | `E` | 1 |
| `account` | `E`'s machine is alive; another account of the same provider is signed in there, under **85 %**. | that account on the same machine; several: the one with the most room | 1 |
| `machine` | Another machine is alive, has the project (or can clone it), has an account of the same provider under **85 %**, and the thread's last checkpoint is not `kind: none`. | several: `E`'s account first, then the most room | 2 |
| `provider` | An engine of another provider is alive, on a machine that has the project, under **85 %**. | `E`'s machine first, then the most room | 3; 1 or 2 when the thread already has a session of that provider (on that machine, on another) |
| `hold` | None of the above. | none | — |
| `new` | The thread has no leg yet. | The rows above without `E`: machines that have the project; the install's preferred provider first; the account with the most room. | 0, or 3 when the thread already has messages |

Ties are broken by engine id in alphabetical order, so the answer never depends on timing. `back` is checked before
`stay`: it is the only row that leaves an engine that works, and only between turns. With `kind: none` (the code
cannot travel), every row keeps to `E`'s machine. `dispatch.ts` implements this table as `decide`, a pure function.

Rules about changing (the reference scenario's "staying is cheap, changing costs"):

- **Only between turns.** The table is consulted when a turn is accepted and when a turn has failed. A running turn
  is never moved.
- **Two thresholds.** A thread stays up to 97 % but enters a new account only under 85 %. An account at 90 % keeps
  its threads and takes no new one.
- **Going back.** A thread on rung 3 returns to its first provider only when that provider's account is under
  **50 %** on both windows, the thread has finished at least 2 turns where it is, and a turn has just ended. A
  window that has barely reset does not pull threads back. This is the row `back`, and the only voluntary change of
  provider: DISP-5 binds it. A forced move (row `provider`, because the current provider has no engine left) may go
  back to the first provider at once; it then resumes its old session (RESUME-6).
- **Compact before a costly move.** A move of account or machine makes the new engine reread the whole provider
  session. When it is over 2 MiB of raw, the provider's own compaction runs at the end of the turn before
  the move. (Not settled: the move is decided at the next turn, after the previous turn ended; "the turn before the
  move" can only be the next turn's start, on the new engine. Not in `decide`, not simulated.)
- **Spread.** Reservations make two threads that fail in the same second pick different accounts when both have
  room.
- **Same provider first (decision D4).** `account` and `machine` come before `provider`. The other order would
  save quota and cost quality at every change.

### When nothing matches

`hold` writes `turn` `held` with one of these reasons. Only then does the user read a sentence, with one action:

| `reason` | The app says | Action |
|---|---|---|
| `no-machine` | None of your machines is on. | Shows which machine has the project. |
| `no-room` | Every account is at its limit until 17:00. | "Tell me when it starts again." |
| `not-signed-in` | Claude is signed out on laptop. | Opens the sign-in. |
| `only-there` | This one can only continue on laptop, which is off. | — |
| `attempts` | It failed three times on an error of its own (`api` or `auth`). | "Try again." |

A held turn is assigned as soon as the table gives an engine: the dispatcher looks again whenever the engine table
changes, and at least every 60 s. When the table gives another reason, the turn is held again with it, so the
sentence the app shows stays true.

## Invariants

To be tested row by row at step 4, and by the simulator: fake engines, the reference scenario, thousands of runs
with random failures (quota gone mid-turn, machine cut, network cut, machine back).

- **DISP-1** The decision is a pure function of the thread's journal, the engine table, the reservations and the
  time. No model call, no randomness.
- **DISP-2** Every `assigned` and `held` event carries the `rule` that matched and a `reason` that states the facts
  used.
- **DISP-3** The engine chosen is alive, signed in on its machine, and has room at the row's threshold.
- **DISP-4** The engine changes only at `accepted` or after `failed`; never while a turn is `running`.
- **DISP-5** After a change of provider, no change back before 2 finished turns and a first provider under 50 %.
- **DISP-6** For one account, the sum of reservations never takes it past 100 % of a window.
- **DISP-7** Simulator, after every run: every accepted message is in exactly one thread, exactly once.
- **DISP-8** Simulator: no turn has two `assistant` answers from two engines.
- **DISP-9** Simulator: every turn ends `done` or `held` with a reason; none stays `accepted`, `assigned`, `running`
  or `failed` once the system is quiet. A held turn's reason is the one the table gives at that moment.
- **DISP-10** The app shows a sentence about engines only for a `held` turn.

## Failure cases

| What happens | Result |
|---|---|
| The quota figures are stale and wrong | The engine refuses on its first request: `failed` with `effect: none`, the quota is read again, the table runs again ([04](04-resume.md)). |
| Three threads lose the same account at once | The first reserves on the best account; the next ones see the reservation and spread. |
| The chosen machine dies before the turn starts | It never took the lease: nothing was written, and the dispatcher decides again 30 s later. `assigned` and `running` are written in the push that takes the lease ([03](03-sync-and-lease.md)); once there, the turn is `running` and a steal fails it with `effect: some`. |
| The dispatcher's machine is off | Messages from the app cannot arrive at all: the app says it cannot reach weevils. Engines at work finish their turns. |
| An account is signed in on no machine that has the project | `hold` with `not-signed-in`. |
| Two engines of the same account on two machines | They share one quota and one reservation ledger entry. |

## Step 4: the dispatcher in weevilsd

Decided with step 4. Everything below runs only with `WEEVILS_THREADS=1`, which implies `WEEVILS_WEEVBOOK=1` and,
when `WEEVILS_WEEVBOOK_HUB` is not set, a hub: `here` on the machine that serves the app, `main` on the others. With
the switch off, weevilsd and the app are as they were.

| File | Role |
|---|---|
| [`server/weevbook/threads.ts`](../../server/weevbook/threads.ts) | The service: inbox, the dispatcher's look at a thread, engines.json, handoffs, what the app reads. |
| [`server/weevbook/dispatcher.ts`](../../server/weevbook/dispatcher.ts) | The dispatcher's memory (engine table, ledger, pending starts, holds) around `decide`. The simulator drives the same class. |
| [`server/weevbook/start.ts`](../../server/weevbook/start.ts) | The engine's machine starts an instruction: lease, session, request. |
| [`server/weevbook/engines.ts`](../../server/weevbook/engines.ts) | `engines.json`: written by each machine, read by the dispatcher. |
| [`server/weevbook/handoff.ts`](../../server/weevbook/handoff.ts) | `handoff.md` and the first request of a new session ([04](04-resume.md#the-handoff)). |
| [`server/weevbook/view.ts`](../../server/weevbook/view.ts) | A thread as the app shows it: messages and one of three states. |
| [`server/threads-app.ts`](../../server/threads-app.ts) | The binding to weevilsd: how a session starts, engine sources, session rows, routes. |

**A message, end to end.** The app posts to `/api/threads/<id>/send` with a key. The message goes to the inbox
(`DATA_DIR/threads-inbox.jsonl`, one line per message, kept until the thread has it; the same key twice is one
message). The dispatcher's look at the thread, one at a time per thread: a `working` lease whose holder is silent is
stolen ([03](03-sync-and-lease.md)); a running turn gets the new messages through its engine; otherwise the messages
are filed as `message` + `turn accepted` (carrying the open leg, THREAD-7) and pushed with an `idle` lease, then
`Dispatcher.place` decides on the table and reserves before the call. The engine's machine (here, or through its
remote: `POST /api/weevbook/start`) takes the lease `working` with `leg.end` (`moved`) when the leg changes,
`assigned`, `leg.start` and `running` in one push, makes the session ready (rung 1 as it is; rung 2 rebuilt from raw,
the checkpoint restored; rungs 0 and 3 a new session that reads the handoff) and gives it the request. The shadow
writer records what the engine does; the hub round renews the lease and lets it go when the turn ends. The
dispatcher looks at every unfinished thread every 10 s, and at once when a message arrives.

**Decided here, where the pages were loose:**

- **The engine reads back what it was sent.** The writer takes the first user line of a dispatched turn that matches
  its request as that turn's own message (`awaitedRequest`): no second message, no second turn. A signed first
  request (preface or handoff) is never a message, never a thread of its own and never a title.
- **A new Codex session.** Its id is known only once its file exists. The lease is taken `working` with `assigned`
  first; `leg.start` and `running` follow in a second push as soon as the file whose first request names the thread
  appears (at most 30 s), else the attempt fails (`api`, effect `none`).
- **A usage-limit stop is a quota reading.** `failed` with `reason: quota` puts that account at 100 % of its 5-hour
  window until a machine with the account publishes `engines.json` after the stop. Without it the next look would
  `stay` on the same account and stop again.
- **A start refused or unanswered.** The machine says why (`busy`, `stale`, `rejected`, `no-folder`, `launch`) or does
  not answer: the placement and its reservation end, and the next look places the turn again (an unanswered machine
  is marked as not answering, as a failed direct call).
- **Messages while a turn runs** go to the running engine, which takes them into its turn ([01](01-thread.md)): the
  dispatcher's machine hands them to the holder (`POST /api/weevbook/deliver`), again every 30 s until it takes them.
- **Expiry.** A request from a chat app (`continue_with_agent`, key `…:req:…`) still held after an hour, that never
  ran, is held again with reason `expired`. Like `attempts`, it waits for the person ("ask again"), never starts by
  itself when machines come back, and does not hold back the turns asked after it. The dispatcher applies it at
  every look, so a request older than an hour when the dispatcher starts ends this way too.
- **Three states.** The app shows `working` (a turn is accepted, assigned, running, or failed and being retried),
  `waiting` (every turn is done) and `paused` (a turn is held). `meta.json` keeps its step-1 rule (a failed turn is
  `paused` there); the app reads the journal (`visibleState`). A paused thread says one sentence only when the person
  can act: `no-machine` (turn it on), `not-signed-in` (sign in), `only-there` (turn that machine on), each with
  "continue" (look now); `attempts` and `expired`, with "ask again" (the same words as a new message). `no-room` says
  nothing but when it goes on.
- **The handoff (D3).** On the machine that ran the turn, 15 s after its end, for threads active in the last 24 h:
  the leg's provider's small model rewrites it, isolated (`claudeHaiku`, or `codex exec` through `server/fast.ts`,
  both through `server/quiet-calls.ts`); a first handoff is the model's rewrite of the journal's. A turn that
  started meanwhile makes it wait for the next end.
- **Session rows.** Each provider session that carries a thread says so (`Session.thread`); the rows of one thread
  are one row, the latest, titled with the thread's title; its status follows the thread's state (a question the
  engine asks, such as a permission, stays: the person answers it). No tool and no relay sign on it.
- **The Codex relay** is not started and its routes answer 404; the app hides every part of it. Its code stays until
  the default changes (deleting it is a separate proposal).
- **Accounts.** `engines.json` lists the Claude accounts of `server/claude-accounts.ts` (the home one without them)
  and the signed-in Codex account. The chosen Claude account is made the active one before its session starts.

**Known limits.** One active Claude account per machine: two threads on two accounts of one machine at once switch
it back and forth. Sessions the shadow writer opens itself (outside the dispatcher) carry the home account's id. A
start runs in the engine's weevilsd, which needs to be reachable as a remote of the machine that serves the app.

**To make it the default** (`WEEVILS_THREADS` on unless `0`), in this order:

1. The Docker scenario of two machines (`test/docker/threads-two-machines.sh`) green on the server, then a week of
   real use with the switch on, on the owner's machines.
2. A hub for every install: `here` exists; a machine without a server needs D1 and D2 first.
3. The new-session path for weevboss and for sessions started from the app (`/api/sessions`), which today start a
   provider session directly: they would file a thread and let the dispatcher start it.
4. The relay's code, settings and texts deleted (`server/relay.ts`, `server/return-relay.ts`, `src/ui/relay.tsx`,
   `src/i18n/relay.ts`, the `relay*` routes and fields): a proposal of its own, over 40 lines (H-4).
5. One active Claude account per machine replaced by an account per session (`CLAUDE_CONFIG_DIR` per launch).
6. `meta.json`'s `state` aligned with the app's (a failed turn is `working` while the dispatcher runs).

## What exists today

- `server/relay.ts` is a dispatcher for one case. It watches Claude's quota (`PREPARE_AT = 90`, `SWITCH_AT = 97`,
  read every 5 minutes), and moves work to Codex. The 97 % and the 5 minutes above are its values. It has three
  user-visible modes (ask, automatic, never) and a threshold setting; this design has neither.
- `server/claude-accounts.ts` rotates to "the next account with room" (`rotate()`), with one active account for the
  whole machine. Here the account is chosen per thread.
- `server/provider.ts` holds the install's preferred provider (`preferredTool`) and whether each is signed in
  (`providerStatus`). `server/usage.ts` reads the quota windows (`QuotaInfo` in `shared/infra.ts`).
- `server/classify.ts`: its first stage (`ruleMatch`) is the filing rule used here. Its second stage calls a model
  and is therefore kept off the path of a message.
- `server/remotes.ts` already tells the main machine within seconds that another machine stopped answering.
- [`server/weevbook/dispatch.ts`](../../server/weevbook/dispatch.ts): the decision table (`decide`), the ledger
  (`reserve`, `release`, `settle`) and the thread's facts from its journal (`threadFacts`). `dispatch.test.ts` has a
  test per row and the worked example above. With `WEEVILS_THREADS=1`, weevilsd uses it (above).
- [`server/weevbook/sim`](../../server/weevbook/sim): the simulator below.
- [`server/weevbook/engines.ts`](../../server/weevbook/engines.ts) (step 4): each machine writes its `engines.json`
  every 60 s; the quota of each account is the app's own reading (`server/usage.ts`, `ClaudeAccounts.quotaOf`).

## The simulator

`npm run sim -- --seeds 20000` runs 20,000 random runs and prints a summary; `--seed <n> --trace` replays one run
step by step; `--reference` runs the reference scenario. A run is drawn from its seed only, so any failing seed is
replayed from its number. `sim.test.ts` runs the reference scenario and 2,000 seeds with every `npm test`.

- **The world.** A phone that only sends messages; a laptop and a server, the server holding the hub and the
  dispatcher (the same `Dispatcher` class as weevilsd: table, ledger, pending starts, holds); three Claude accounts on both machines and Codex on the laptop; quotas that run out in the middle of a
  turn; machines switched off and on, links cut, answers to the phone lost; clocks a few seconds apart, and in one run
  in six minutes apart or drifting by 1 to 3 %. The rules are the real ones: `lease.ts`, `turn.ts`, `dispatch.ts`.
- **The reference scenario.** Four threads at work at once on three accounts, one of them on Codex. The laptop dies
  in the middle of a turn; an account reaches zero in the middle of another; the laptop comes back while the server
  answers the thread it lost.
- **Checked after each run.** DISP-1, DISP-3, DISP-5, DISP-6, DISP-7, DISP-8, DISP-9; SYNC-2 to SYNC-5, SYNC-7,
  SYNC-11, SYNC-12; RESUME-8 (including that a failure never claims less effect than the journal shows); every
  journal against `validateJournal`. And: every change of engine is forced (`E` could not stay) or a `back`; every
  hold is justified (no engine could take the turn); a holder that could renew all along never loses its lease
  while clocks are within 30 s.
- **Results** (20,000 seeds, about 10,700 simulated hours): no violation. Steals came at most 128 s after the last
  renewal; none took a lease from a holder that could still renew, with any clock; every orphan came back as a note;
  at most 6 engine changes in one thread.

## Not in v1

- More than one dispatcher (two machines both serving the app).
- Choosing an engine by price, speed or model quality.
- Using someone else's account. Accounts are the user's own.
- Moving a turn while it runs.
- Learning the cost of a turn from history: reservations are fixed numbers at first.
