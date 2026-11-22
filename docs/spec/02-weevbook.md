# 02 · Weevbook

The weevbook is a private git repository that holds every thread of one person: one folder per thread, filed by
project and month. Everything in it is text you can read, except attachments. The journal is the truth; the other
files of a folder are rebuilt from it.

```
weevbook/                                  (branch main)
  README.md                                what this repository is, in 15 lines (generated)
  index.json                               the threads, and the commit each folder was taken from (generated)
  projects/
    shop-app/
      2026-11/
        01M7QDKAT85KGENVY3NP4N74YB-add-csv-export-to-orders/
          events.jsonl                     the journal: append-only, the truth
          thread.md                        the thread as you read it        (generated from the journal)
          meta.json                        title, project, state, legs      (generated from the journal)
          handoff.md                       the handoff for another engine   (rewritten after each turn)
          attachments/
            5169e871…2edb.csv              a file of the thread, named by its SHA-256
          raw/
            L1.claude.0001.jsonl           the provider's own lines for leg L1, redacted
            L2.codex.0001.jsonl
    _unsorted/                             threads without a project
```

## A worked example

[`examples/weevbook`](../../examples/weevbook) is a complete small weevbook: two projects, three threads.

| Thread | What it shows |
|---|---|
| `shop-app/…-fix-the-login-redirect` | A Claude Code thread. The laptop goes silent mid-turn; the server continues it (rung 2). A late event from the laptop is kept as a `note`. |
| `shop-app/…-add-csv-export-to-orders` | Claude Code reaches its usage limit mid-turn; Codex finishes the turn from the handoff (rung 3) and keeps the thread. An attachment, and a redacted command. |
| `trip-planner/…-offline-maps-for-the-itinerary` | Six messages arrive from ChatGPT through the connector. The thread is filed under a project, then an engine does the work. |

The start of the second one's `thread.md`:

```markdown
# Add CSV export to orders

Project: shop-app · Started 2026-11-18 13:30 UTC · Thread 01M7QDKAT85KGENVY3NP4N74YB

---

**You** · 2026-11-18 13:30 UTC

Add a CSV export to the orders page. Same columns as the attached sample.

Attachment: [orders-sample.csv](attachments/5169e871e838550a9f845ea5c8902b35fca51c44071b9a1b7e57eda4ae532edb.csv)

- Read · /home/alex/.local/share/weevils/uploads/orders-sample.csv
- Grep · OrdersTable
- Write · src/orders/export.ts
- Edit · src/orders/OrdersPage.tsx
- Bash · SHOP_API_TOKEN=[redacted] curl -s "https://api.example.com/orders?limit=5"

**Agent** · 2026-11-18 13:34 UTC

The export is in place. …
```

The file does not say that Codex wrote the second half. That is in the journal and in `meta.json`.

## Format

### Folder name

`projects/<project>/<YYYY-MM>/<thread id>-<slug>`

| Part | Rule |
|---|---|
| `<project>` | The latest `project` in the journal's `meta` events: a slug. `_unsorted` when there is none. |
| `<YYYY-MM>` | Year and month (UTC) of line 1. Never changes. |
| `<slug>` | The latest title: accents removed, lower case, every run of other characters becomes `-`, at most 48 characters. `untitled` when empty. |

A new title or project moves the folder on `main`. The thread's own git ref has no folder name in it
([03](03-sync-and-lease.md)), so nothing is rewritten: only the composed view changes.

### Files of a thread

| File | Source | Rule |
|---|---|---|
| `events.jsonl` | written | The journal ([01](01-thread.md)). Lines are appended, never changed or removed. |
| `thread.md` | generated | `renderThread(events)`. Header, then messages (`**You**`, `**Agent**`, `**ChatGPT**`, `**Claude**`, or an author's name), tool steps as a list, attachments as links. Times in UTC. Nothing about legs, engines or turns. |
| `meta.json` | generated | `renderMeta(events)`: see below. |
| `handoff.md` | written | The handoff ([04](04-resume.md#the-handoff)). Absent until the first `handoff` event. Its SHA-256 is in that event. |
| `attachments/<sha256><.ext>` | written | The bytes of one `attachment` event. `<.ext>` is the lower-cased extension of the event's `name`, when it has a plain one. The same file sent twice is stored once. |
| `raw/<leg>.<provider>.<nnnn>.jsonl` | written | The provider session's lines for that leg, in order, redacted. Segments are numbered from `0001`; a new one starts before the current one would pass 1 MiB (a single line bigger than that stands alone in its own segment). Segments written before 2026-11-22 may reach 16 MiB and stay as they are. Only what the provider wrote during the leg: a leg that resumes a session starts where the previous leg's raw ends. |

`meta.json`, for the first sample thread:

```json
{
  "v": 1,
  "thread": "01M7M8E6XR7ZVPYA7TRMHKHR25",
  "title": "Fix the login redirect",
  "project": "shop-app",
  "created": "2026-11-17T08:02:11Z",
  "updated": "2026-11-17T09:40:12Z",
  "state": "waiting",
  "turns": 2,
  "events": 35,
  "sources": ["claude", "weevils"],
  "legs": [
    { "leg": "L1", "engine": "claude:a3f9c1@laptop", "rung": 0, "started": "2026-11-17T08:02:14Z", "ended": "2026-11-17T08:19:02Z" },
    { "leg": "L2", "engine": "claude:a3f9c1@server", "rung": 2, "started": "2026-11-17T08:19:09Z", "ended": null }
  ],
  "checkpoint": { "turn": 2, "kind": "git", "commit": "…" },
  "handoff": { "upTo": 33, "by": "claude:a3f9c1@server" }
}
```

(The real file puts each value on its own line: two-space `JSON.stringify`.) `state` is one of three, the only three
the app ever shows: `working` (a turn is accepted, assigned or running), `waiting` (every turn is done: it is your
move), `paused` (a turn is held or failed: the app says what to do).

### Writing

- A file that is replaced (`thread.md`, `meta.json`, an attachment, `index.json`) is written beside its place
  (`<name>.next`), flushed to disk, then renamed. A power cut leaves the old file or the new one, never half of one.
  `server/outbox.ts` does the same today.
- A file that grows (`events.jsonl`, a raw segment) is appended to in place, after a record of the write is saved
  with each file's size before it (`.git/weevbook/tx/<id>.json`, itself renamed into place). The record is removed
  once every file of the write is flushed. A record still there at the next start is a write a crash cut short:
  each file is cut back to its size before, the attachments it added are removed, `thread.md` and `meta.json` are
  rebuilt. So the journal and its raw lines always move together, and old bytes are never touched (BOOK-2).
  Decided at step 1: copying a 16 MiB segment to add one line, every few seconds of a live session, writes far more
  than the session itself; nothing reads the files between a crash and the next start but weevils, which undoes the
  write first.
- Raw segments are sealed at 1 MiB (decided 2026-11-22). git keeps a whole new copy of a file each time it changes: a
  segment that grew to 16 MiB added up to 16 MiB to the history at every turn, a weevbook reached several GB, and
  git's repacking of it at full priority on every core made a laptop's fans spin. A sealed segment never changes again,
  so each commit adds at most 1 MiB of raw, and the weevbook's `git gc --auto` runs on one core at the lowest priority,
  at most once an hour (`gentleGc`, `server/weevbook/gitrun.ts`). The hub's own gc after a push is off
  (`receive.autogc=false`); the machine that keeps the hub tidies it the same way.
- `thread.md` and `meta.json` are rebuilt after every append. When in doubt they are rebuilt: nothing reads them as
  truth.
- An event the journal refuses (`appendEvent` throws) is not dropped: a `note` of kind `debug` holds it in `data`.

### Redaction

A thread holds command lines and file contents. Before anything is written to the weevbook, every string is passed
through `redactToolText` (`server/codex-command-details.ts`) with no length limit:

| What it catches | Written as |
|---|---|
| A PEM private key block | `[redacted]` |
| `Bearer <token>` | `Bearer [redacted]` |
| `https://user:password@host` | `https://[redacted]@host` |
| `sk-…` keys, JSON Web Tokens | `[redacted]` |
| `<name with token, password, secret, api_key, authorization, cookie> = <value>` | `<name> = [redacted]` |

What follows such a name but is not a value stays as it is: a variable or a command named (`$NAME`, `"${NAME}"`,
`"$(…)"`), an empty string, the quote that closes a text opened just before the name (`grep "^API_KEY=" .env`), and
a value already `[redacted]`. A value written in single quotes (`'$NAME'`) is a value.

- **Events**: every string field.
- **Raw**: each line is parsed, every string value inside it is redacted, and the line is written again as JSON. The
  function is never run over the line as text: that would break the JSON. A line in which nothing changed is kept
  byte for byte (a provider session rebuilt from raw is the provider's own file).
- **A key that names a secret** (a JSON key matching `token`, `password`, `passwd`, `secret`, `api_key`,
  `authorization`, `cookie`): its string value is written `[redacted]` whatever it looks like. Inside one string the
  patterns see `name = value`; in a JSON object the name is the key.
- **A raw line that is not JSON** (cut by a crash): written as one JSON string, redacted as text. Raw holds JSON lines
  only (BOOK-6); a raw line that parses to a string is such a line.
- **A raw line over 16 MiB**: written as `{"weevbook":"omitted","reason":"line over 16 MiB","bytes":…,"sha256":…}`.
- **Idempotent.** Redacting a redacted text changes nothing (BOOK-9 depends on it). At step 1 the `name = value`
  pattern took the marker and what followed it for a new value (`KEY=[redacted]" run` lost `" run` the second time);
  a value that starts with the marker is now left as it is. Property-tested over random texts, every string of the
  fixtures and the shapes above.
- The patterns run in time proportional to the text (`redactToolText`; its `name = value` pattern was rewritten as one
  pass at step 1: as a single regular expression it took time in the square of a long run of word characters).
- **A step's label** (`Bash · <command>`, the app's and the journal's alike) is redacted before it is cut to 90
  characters: cut first, a value broken in the middle was no longer one the patterns saw, and its end showed.
- **`handoff.md`**: the whole text. The handoff names environment variables; it never holds their values.
- **Attachments** are not scanned. They are files the user or the engine chose to attach.

This is pattern matching. It lowers the risk; it does not prove a weevbook holds no secret. Where the weevbook may
go is therefore a decision of its own ([03, open decisions](03-sync-and-lease.md#open-decisions)).

## Invariants

Checked by `validateFolder` on one thread folder (BOOK-2 by `extendsJournal` on two versions of a journal).

- **BOOK-1** The folder's path is `projects/<project>/<YYYY-MM>/<id>-<slug>`, computed from its journal.
- **BOOK-2** A newer `events.jsonl` starts with every byte of the older one.
- **BOOK-3** `thread.md` equals `renderThread(events)`, byte for byte.
- **BOOK-4** `meta.json` equals `renderMeta(events)`, byte for byte.
- **BOOK-5** Every `attachment` event has its file, whose SHA-256 and size match. No file in `attachments/` is
  without an event.
- **BOOK-6** Every raw file is named for a leg of the thread and that leg's provider; segments run `0001`, `0002`, …
  with no gap; each holds JSON lines and is at most 16 MiB (new segments are sealed at 1 MiB, unless one line is bigger).
- **BOOK-7** `events.jsonl` is UTF-8 with line feeds only, one JSON object per line in the canonical field order, no
  blank line, a final line feed, and no line over 1 MiB.
- **BOOK-8** `handoff.md` exists exactly when the journal has a `handoff` event; its SHA-256 is the one in the last
  such event, and its `upTo` header says the same number.
- **BOOK-9** Redaction is a fixed point: running it again over any string of the journal, of raw or of `handoff.md`
  changes nothing.
- **BOOK-10** A thread folder holds the files above and nothing else.

## Failure cases

| What happens | Result |
|---|---|
| `thread.md` or `meta.json` is edited by hand, or lost | Rebuilt from the journal at the next append or by `weevils weevbook check`. |
| `events.jsonl` is edited by hand | BOOK-2 fails at the next sync: the machine keeps its own copy and reports the thread. Nothing is merged. |
| A message longer than 1 MiB | The `message` event holds the first 4,000 characters and ends with `…`; an `attachment` event right after it holds the full text as `message.txt`. |
| An attachment's bytes are missing (interrupted upload) | The `attachment` event is not written until the file is in place. |
| The disk is full | The append fails before the rename. The turn is `failed` with `effect` as observed; the app says the disk is full. |
| Redaction replaces something that was not a secret | The original is still in the provider session on the machine where it ran. The weevbook keeps `[redacted]`. |

## Step 1: the local weevbook

On each machine, in weevils' data dir (`~/.local/share/weevils`):

| Path | What |
|---|---|
| `weevbook/` | The files, laid out as `main` (`README.md`, `index.json`, `projects/…`): readable as they are. |
| `weevbook/.git` | The repository, with `core.bare` set: no index, nothing is ever checked out over the files. `refs/threads/<id>` and `refs/heads/main` ([03](03-sync-and-lease.md#the-refs)). |
| `weevbook/.git/weevbook/index/<id>` | A private git index per thread: a commit hashes again only the files that changed. |
| `weevbook/.git/weevbook/tx/<id>.json` | A write in progress ([Writing](#writing)). |
| `weevbook.lock` | One writer at a time: weevilsd's writer or the `weevils weevbook` command (`<pid> <token>`; a lock left by a process that is gone is taken). |
| `weevbook-sessions.jsonl` | Provider session → thread, leg, and how far it was read. Append-only, the last line of a session wins; written before the thread, so a crash never makes two threads for one session. Step 2 adds `moved` (its thread went to another machine: no longer written here) and `base` (a session rebuilt by a resume: the lines of earlier legs it starts with). |
| `weevbook-hub.json` | Step 2: how the sync with the hub goes, for `weevils weevbook sync status`. |
| `hub.git` | Step 2, on the hub's machine only: the hub ([03](03-sync-and-lease.md#step-2-the-hub-weevils-sets-up)). |
| `checkpoints/<id>.git` | Step 2: the private repository of a folder without git ([04](04-resume.md#checkpoints)). |

- **Writer** (`server/weevbook/writer.ts`, in weevilsd, on unless `WEEVILS_WEEVBOOK=0`): every 3 s it looks at the
  session files the app reads, one at a time, under the lock, never in the app's loop. An error is logged once and
  stays there.
- **`weevils weevbook backfill`**: every session file of the machine (`~/.claude/projects/*/*.jsonl`,
  `~/.codex/sessions/**`), oldest first, through the same code as the writer, then `main`. Running it again writes
  nothing. A session file that is still being written is taken up by the writer where the backfill stopped.
- **`weevils weevbook check [--repair]`**: every thread against `validateJournal` and `validateFolder` (counts by
  invariant), plus: the journal of `refs/threads/<id>` is the start of the folder's (a running turn is committed at
  its end), and `index.json` of `main` names a commit on that ref (SYNC-8). `--repair` rebuilds `thread.md` and
  `meta.json`.
- **`weevils weevbook compare [--verbose]`**: for every session, the messages the app makes of it
  (`parseTranscriptText`, the app's own reader, with no 400-message cap) against the thread's journal, over the lines
  the weevbook has read. Exit 1 on a message missing or altered. Counted apart, as intended: a text with a secret
  redacted (the journal's text is the app's with parts replaced by `[redacted]`: raw is redacted per JSON value, so
  the journal may redact more than the app shows, never less), a message over 1 MiB cut (its full text is
  `message.txt`), and a provider's error sentence, which the app shows as a reply and the journal holds as a `failed`
  turn. Codex tool steps are compared by call id, since the app
  labels them in the reader's language.

## The weevbook page (step 4)

With `WEEVILS_THREADS=1`, the app reaches the weevbook from where projects are listed (the `≡` beside a project's
name, and a line on the project's page). It lists the threads of a project, newest first, with their state; searches
titles, projects and `handoff.md` (`GET /api/threads?project=&q=`); opens one to reread it in the app's own look
(the journal's messages, steps and attachments, as `thread.md` has them); and continues it by writing in it. It
replaces nothing yet: sessions keep their own list, collapsed to one row per thread. The state shown is the app's
([06](06-dispatch.md#step-4-the-dispatcher-in-weevilsd)), not `meta.json`'s.

## What exists today

- Step 1 above. Before it there was no weevbook. Threads live in provider files (`~/.claude/projects/<folder>/<id>.jsonl`,
  `~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`), read by `server/transcripts.ts` and never copied.
- `server/conversations.ts` imports ChatGPT and Claude.ai exports into SQLite (`weevils.db`: tables `conversations`
  and `messages`), with each message cut at 60,000 characters. It reads the export formats this design needs for the
  `import` source. Its storage is replaced by the weevbook; its parsers stay.
- `server/classify.ts` files a conversation under a project: first by rule (a project or repository name appears in
  the text), then by a model call. The weevbook uses the rule at once and lets the model re-file later with a `meta`
  event ([06](06-dispatch.md)).
- `redactToolText` exists and is used on what the app displays. Its default cuts the text at 8,000 characters; the
  weevbook calls it without a limit, one string value at a time (`server/weevbook/redact.ts`).
- `server/attachments.ts` serves images of a session to the app from their original paths. Nothing stores
  attachments by hash yet.

## Not in v1

- Full-text search inside the repository (the weevbook page searches titles and `handoff.md` first).
- Scanning attachments for secrets.
- Deleting a thread. It will be a tombstone event plus a history rewrite of that thread's ref, specified with step 5.
- Translated `thread.md`. Labels are English on every machine, so that the file is the same everywhere.
