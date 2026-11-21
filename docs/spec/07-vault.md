# 07 · Vault: every conversation, kept on your GitHub

**Status: steps 1 and 2 built** (`server/weevbook/vault.ts`, `vault-cli.ts`, `vault-github.ts`, `vault.test.ts`,
`server/join.test.ts`): journals, attachments and handoffs, the recovery code, the import at install and its choices,
the join that carries the vault, a new machine from the vault, the summary, and the onboarding in weevboss's chat.
Steps 3 and 4 are design. This page settles D1 and D2 of [03](03-sync-and-lease.md#open-decisions) the way the
owner chose on 2026-11-21: the hub of every install is the person's own GitHub, encrypted, whether they have no
server, one, or ten. The owner took the recommended answer to the four decisions at the end (2026-11-21). The person
feels only what they must: one GitHub sign-in, the recovery code once, the history question, and agreed moves.

## What it is for, in order

1. **Ownership, retroactive.** Someone installs weevils today and finds every conversation they had with Claude Code
   and Codex, on every machine, with every account, before weevils existed. From then on nothing is lost: not when a
   machine dies, not when a subscription ends, not when a provider deletes its files after 30 days.
2. **Conservation for agents, not for reading.** What is kept is what an agent needs to continue a conversation: the
   journal, the provider's own lines with the thinking, and the state of the code. Nobody reads it on github.com.
3. **Moving work, on request.** A conversation continues on another machine or account when the person says so, or
   when weevboss proposes it in one line and the person agrees ("the server has been silent for 12 minutes: continue
   this on the laptop?"). Changing the Claude account on the same machine needs none of this page.

## The picture

```mermaid
flowchart LR
  subgraph m1[laptop]
    b1[weevbook<br/>plain, complete]
  end
  subgraph m2[server]
    b2[weevbook<br/>plain, complete]
  end
  subgraph gh[your GitHub, private]
    v[weevbook-vault<br/>journals, checkpoints]
    r1[weevbook-raw-001]
    r2[weevbook-raw-002]
  end
  b1 -- "encrypt, push" --> v
  b2 -- "encrypt, push" --> v
  b1 -- "encrypt, push" --> r2
  v -- "fetch, decrypt" --> b2
```

Each machine keeps its own weevbook as today ([02](02-weevbook.md)): plain, readable, complete. The **vault** is the
copy on GitHub: the same threads, encrypted, in the person's own private repositories. It replaces the hub on a
machine (`WEEVILS_WEEVBOOK_HUB=here`). No machine is special any more: any machine can die and the vault has
everything; a new machine fetches the vault and has everything.

## What goes where

| | On each machine | In the vault |
|---|---|---|
| Journals (`events.jsonl`), titles, projects | all threads | all threads |
| Checkpoints of the code | the threads it ran | all threads |
| Raw lines, full | the threads it ran, and those it resumed | no |
| Raw lines, **slim** | — | all threads |
| Attachments | the threads it ran | all threads |
| `thread.md`, `index.json` | rebuilt from the journal | no (rebuilt) |
| `handoff.md` | the threads that have one | all threads that have one (step 2: a model writes it and the journal keeps only its SHA-256, so it cannot be rebuilt) |

**Slim raw.** Measured on the owner's server (2026-11-21, ~600 threads, two weeks): 1,083 MB of Claude raw lines, of
which 575 MB are tool results over 20 KB and the `toolUseResult` copies Claude Code keeps next to them; the thinking
is 26 MB. Slim raw is the raw with exactly two cuts: a tool result over 20 KB keeps its first and last 8 KB with a
marker between (`[… 412 KB kept on <machine> …]`), and `toolUseResult` objects over 2 KB are dropped (the model never
reads them). Everything else is kept byte for byte, thinking blocks and their signatures included. A provider resumes
from slim raw: the model sees a long command output shortened, the way a person would scroll past it.

## The format on GitHub

Encryption is per file, not per repository: the lease needs GitHub to see real refs and commits
([03, D2](03-sync-and-lease.md#open-decisions)). And per **immutable chunk**, not per file: an encrypted file that
changes is a new blob each time with no delta, so a journal re-encrypted at every turn would grow the repository by
its whole size each time.

```
weevbook-vault                         refs/threads/<thread id>  → a commit whose tree is:
  m                                    the manifest: ordered list of chunk names, encrypted (small)
  c/<sha256>                           one chunk: events appended in one push, zstd, encrypted
  a/<sha256>                           one attachment, encrypted
  h                                    handoff.md as the journal last recorded it, encrypted (replaced when rewritten)
                                       refs/leases/<thread id>   → lease.json, encrypted
                                       refs/checkpoints/<thread id> → an encrypted git bundle of the turn
                                       refs/heads/main           → only a README (what this is, no data)

weevbook-raw-NNN                       refs/raw/<thread id>      → m + c/<sha256>, slim raw chunks
```

- A push adds the chunks of what is new and a new manifest. Nothing already pushed changes.
- Names say nothing: thread ids are ULIDs (they show a creation time, nothing else); chunk names are hashes of the
  ciphertext. No title, project, machine or account name leaves in clear. `main` with its titled folders is never
  pushed.
- Encryption: one 32-byte **vault key**, AES-256-GCM (Node's own `crypto`), a random 12-byte nonce per file, the
  thread id as associated data (a chunk moved to another thread fails to decrypt). The plain text is zstd-compressed
  first (measured: 3.3× on raw lines).
- Raw repositories: a new `weevbook-raw-NNN` when the current one passes 700 MB, under GitHub's 1 GB recommendation.
  At the owner's pace (≈ 25 MB of slim compressed raw a day) that is one repository every month or so. The vault
  itself grows by ≈ 1 MB a day.

## Access to GitHub

The person connects GitHub once, in the chat with weevboss (`gh auth login` on the first machine, the device-code
flow: a code to type on github.com). With it, weevils creates the private repositories and gives **each machine its
own deploy key** with write access to those repositories only. The `gh` token itself is not kept for the vault.

- A machine joined with one line ([install, several machines](../install.md#several-machines)) gets its deploy key from the main machine in the same
  exchange, and pushes to GitHub directly. The joined machine's narrow SSH key to the server stays as it is: it no
  longer needs to reach any hub there.
- A new raw repository gets every machine's key when it is created. (Found at step 2: GitHub accepts a deploy key
  on one repository only, "key is already in use" on a second. With raw repositories, step 3, each machine needs one
  key per repository, or the access model changes; today there is one repository and one key per machine.)
- Removing a machine removes its deploy keys.

## The vault key

It is made on the first machine and given to each machine when it joins (inside the one-line exchange, which already
carries a one-time secret over HTTPS). It lives in `~/.config/weevils/vault.key` (0600). Lose every machine and the
vault is unreadable, so weevboss gives the person a **recovery code** once, when the vault is created: the key as 24
words, with one sentence ("Keep this somewhere safe, like a password: with it, a new machine gets everything back").
A new install that finds an existing vault on the person's GitHub asks for it, in the chat.

## The history: retroactive import

On every machine, at install or join, with no question:

1. The writer is on (`WEEVILS_WEEVBOOK` defaults to 1).
2. `weevils weevbook backfill` runs once in the background, at low priority, over every Claude Code and Codex session
   still on the machine. The machine's weevbook then pushes it to the vault, oldest last.

Then weevboss says, in the person's language, once the server is ready to carry their work:

> Your server is ready to carry your work. Want me to bring over your whole history, or do you have a date or a few
> conversations in mind?

- "Everything": nothing more to do on this machine; for another computer, weevboss gives the one line to paste
  there, and that machine imports its own history.
- A date or a few conversations: the backfill of the other computer takes `--since <date>` or `--match <words>`.
- Claude.ai and ChatGPT: weevboss offers the official export, which weevils already imports.

When the import is done:

> Done: 412 conversations from your MacBook and this server, across two Claude accounts and Codex. From today they're
> yours, not Claude's, not OpenAI's, not any one machine's. They live in your private GitHub, and you can reopen and
> continue any of them right here. Machines and subscriptions come and go; your work stays. You're independent now.

Claude Code deletes its own sessions after 30 days by default (`cleanupPeriodDays`): weevboss says "the last 30
days" when that is all there is, never "everything".

## A new machine

It fetches the vault and decrypts every journal into its weevbook: the whole history is in the app at once (≈ 30 MB
for the owner's two weeks). Raw lines and checkpoints are fetched only for a thread it resumes.

## Moving a conversation

The lease of [03](03-sync-and-lease.md) works on GitHub as it is (atomic multi-ref push, compare-and-swap with
`--force-with-lease`). Two changes, both from the owner's decision that switches are rare and agreed:

- **Slower lease.** Renewed every 5 minutes instead of 20 seconds; a working machine's pushes after each turn renew
  it too. Measured cost: at most 12 pushes an hour per working thread.
- **No silent steal.** A lease that stops being renewed makes weevboss propose the move in one line; the steal of
  [03](03-sync-and-lease.md) runs when the person agrees, or when they themselves say "continue this on the laptop".
  Everything after the steal is unchanged ([04](04-resume.md)).

The dispatcher of [06](06-dispatch.md) keeps its table; its automatic moves become proposals with the same reason
line. A direct order ("send this to Claude on vps-1", "use two accounts and three servers for this") skips the
proposal: it is the agreement.

## Invariants

- **VAULT-1** No byte pushed to GitHub, outside `main`'s README, is readable without the vault key: a test pushes a
  weevbook with known titles, paths, commands and secrets, then searches every object of the remote for them.
- **VAULT-2** Every machine lost, recovery code kept: a new machine gets back every journal, every checkpoint, every
  slim raw line, byte for byte against the old machines' copies (slim raw against the slim of their raw).
- **VAULT-3** A push never rewrites a chunk: the objects of the remote only grow by the new turn's chunks.
- **VAULT-4** A Claude session rebuilt from slim raw resumes, and its thinking blocks reach the API unchanged.
- **VAULT-5** A backfill run twice pushes nothing the second time.
- **VAULT-6** No lease is stolen without the person's agreement or order.
- **VAULT-7** Each repository stays under 1 GB.

VAULT-4 is built (2026-11-21): raw redaction and the path rewrite of a moved session leave Claude's signed blocks
(`thinking`, `redacted_thinking`) byte for byte; a thinking block an older redaction changed (one in the owner's ~12,000)
is dropped at resume, its line's children taking its parent. Measured on a real session with Claude Code 2.1.327: a
changed thinking block of an earlier turn was accepted by the API anyway, and recent models write the thinking as an
empty text with its signature, so the risk was small; the rule keeps it at none.

## Steps

1. **Vault writer.** Encrypt and push journals, chunks and attachments; the import at install; the recovery code.
   The plain hub on a machine keeps working beside it for existing installs. *Built:*
   - `server/weevbook/vault.ts`: sealing (AES-256-GCM, a format byte then the nonce; zstd from Node's own `zlib`,
     gzip on a Node without it; associated data: the thread id and the file's kind, `m`, `c` or `a`), the recovery
     code (BIP39, the English list in `server/weevbook/data`), the push and the restore. The manifest holds the
     ordered chunks, the journal's length and SHA-256, and the attachments by their file name in the thread. Commits
     are by `vault <vault@weevils.invalid>`, dated 2000-01-01, message `vault`; `a/` names are the hash of the
     ciphertext like `c/`, so a known file cannot be recognised by its hash.
   - Pushing builds the commits in `DATA_DIR/vault.git` from the weevbook's thread refs, fetches the vault first (a
     thread another machine pushed is built on), and pushes the refs that moved with `--atomic`, by groups of 100,
     newest threads first. A thread whose journal is not an extension of the vault's (another machine wrote it
     differently) is left out and counted, until the lease on GitHub (step 4).
   - Restore decrypts every journal and its attachments into the weevbook (the local raw lines are kept), rebuilds
     `thread.md` and `meta.json`, and composes `main`. `handoff.md` comes with step 2.
   - `weevils weevbook vault setup` (with `gh`: the private repository `<login>/weevbook-vault`, this machine's
     deploy key `CONFIG_DIR/vault-deploy`, the key `CONFIG_DIR/vault.key` and its 24 words printed once, the remote
     in `CONFIG_DIR/vault.json`; `--remote <url>` skips GitHub), `vault push`, `vault restore [--code "…"]`,
     `vault status`. Setup against a vault that exists, without its key, refuses and points at `restore`.
   - In weevilsd: `WEEVILS_VAULT` (`0` off, a git URL, or empty/`1` for the remote setup saved); every 30 s the
     pusher pushes when the thread refs moved, an error logged once, the next try 5 minutes later.
   - The writer is on by default (`WEEVILS_WEEVBOOK=0` turns it off) and the first start runs `weevils weevbook
     backfill --once` at the lowest priority, which writes `DATA_DIR/weevbook-backfilled` when done.
2. **A new machine from the vault**, and the onboarding question and summary in weevboss's chat. *Built:*
   - **The join carries the vault** (`server/join.sh`, `server/join.ts`, `server/weevbook/vault-github.ts`): join.sh
     makes a second key for the vault only (`CONFIG_DIR/vault-deploy`) and sends its public half with the one-time
     code; the main machine, when it has a vault, registers it on the vault's repository through `gh api` (write
     access, title `weevils <machine id>`) and answers with `vault_remote` and `vault_key`; join.sh writes
     `vault.json` and `vault.key` (0600, never over another vault's key), so that machine's weevilsd pushes its own
     first import. No vault on the main machine, or `gh` not signed in there: the join is what it was and says
     nothing; why is kept by machine in `DATA_DIR/vault-machines.json`, which `weevils setup` and `vault summary` show
     (pasting that computer's line again fixes it). The join's forced-command SSH key is untouched. A one-time code no
     longer starts with a dash (`bash -s -x…` took one line in 64 for a bash option).
   - **The import choices**: `weevils weevbook backfill --since <date>` (sessions whose last line is on or after that
     day) and `--match <words>` (every word in the title, Codex's thread name or the first request; case and accents
     ignored). The default stays everything. For another computer they ride on its join line, after the code
     (`… | bash -s <code> --since 2026-10-01`, `--match 'words'`; `weevils setup ask machine --since … | --match …`
     posts it): join.sh checks them and leaves `CONFIG_DIR/backfill.json`, which that machine's first import
     (`backfill --once`) reads.
   - **Restore** also brings `handoff.md` back, sealed in the vault as `h` (the manifest keeps its SHA-256): written
     only when it is the one the journal's last `handoff` event records. On a machine that already has threads it
     merges, thread by thread: the same journal is left alone, a longer one here stays and is pushed next, a shorter
     one is completed, a differing one is left out and counted. A thread already checked against the same commit is
     not opened again. `vault restore --code` on a machine with no remote saved finds `<login>/weevbook-vault`
     through `gh` and adds this machine's deploy key (it never creates a repository); words of another vault are not
     kept. The restored threads are what `/api/threads` lists (`threadRefs`: title, project, state, `handoff.md`).
   - **`weevils weevbook vault summary [--json]`**: `conversations`, `machines` and `by_machine`, `accounts` by
     provider, `oldest`, `remote` (`owner/repo`), `claude_window`, `import` (`running` or `done`), `pending`,
     `fetched`, `missing` (machines plugged in without the vault). It fetches the vault and opens the other machines'
     threads in memory, keeping their few facts by commit in `DATA_DIR/vault.git/weevils-summary.json`; nothing is
     written to the weevbook. `claude_window` is true when the Claude conversation that has been quiet the longest is
     about `cleanupPeriodDays` old (30 by default, read from `~/.claude/settings.json`; 7 days before to 3 days after).
   - **In weevilsd** the pusher starts as soon as a vault is set (the remote and the key, looked for every 30 s): no
     restart after `vault setup`, `vault restore` or a join.
   - **weevboss's onboarding, by talking only** (`server/orchestrator.<lang>.md`, `firstRunBrief` and
     `githubDevice` in `server/setup.ts`): `weevils setup github` runs `gh auth login --web` and posts the code and
     the github.com/login/device link in weevboss's name (gh is installed first when missing); when the code was typed,
     weevboss is handed the next step and runs `weevils weevbook vault setup` itself, gives the 24 words once, asks the
     history question, says the summary sentence from `vault summary --json` ("the last 30 days" when
     `claude_window`), and offers the Claude.ai and ChatGPT export once. `weevils setup` has a `vault` line with what
     was said already (`weevils setup mark vault:code | vault:history | vault:summary | vault:export`). A new install
     that finds a vault on the person's GitHub (`vault: found`) asks for the recovery code in the chat.
   - *Deviations.* `handoff.md` is in the vault (the table above said rebuilt). A machine does not fetch the other
     machines' threads into its weevbook by itself: `vault restore` does it when asked, and the summary reads them in
     memory (an automatic restore next to a hub's own sync waits for the lease on GitHub, step 4). The accounts counted
     are the ones the import could name: sessions read at install carry the account signed in then. When the main
     machine cannot give a join line (no public https address), the vault does not reach the other computer yet.
3. **Slim raw and checkpoints in the vault**, and resuming a thread from them (VAULT-4).
4. **Lease on GitHub**, weevboss's proposals, direct orders.

## Decisions (taken 2026-11-21: the recommended answer to each)

**V1 · Recovery code.** *Recommended:* weevboss gives it once, as 24 words. *Other:* no recovery code (lose every
machine, lose the vault); or the key on GitHub, encrypted with a passphrase the person chooses.

**V2 · Raw lines on GitHub.** *Recommended:* slim (about half the size, resumes the same). *Other:* full raw (twice the
repositories, every output kept); or no raw (a new machine resumes from the handoff only, losing the thinking).

**V3 · GitHub access.** *Recommended:* one deploy key per machine, limited to the vault's repositories. *Other:* the
person's `gh` token on every machine (simpler, but a stolen machine reaches all their repositories).

**V4 · A machine that goes silent.** *Recommended:* weevboss proposes the move, the person agrees. *Other:* automatic
after a delay the person sets.

## What exists today

- [`server/weevbook/hub.ts`](../../server/weevbook/hub.ts), [`lease.ts`](../../server/weevbook/lease.ts): the sync
  and the lease, over any git remote. The vault adds encryption between the weevbook and the remote.
- [`server/weevbook/backfill.ts`](../../server/weevbook/backfill.ts): the import of a machine's sessions, run by hand
  today (`weevils weevbook backfill`).
- [`server/weevbook/redact.ts`](../../server/weevbook/redact.ts): `redactRawLine`, which VAULT-4 changes.
- [`server/join.ts`](../../server/join.ts): the one-line join, which carries the vault key and the deploy key.
- [`server/conversations.ts`](../../server/conversations.ts): the import of Claude.ai and ChatGPT exports.
