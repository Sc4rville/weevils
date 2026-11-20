# ADR 0003 · The lease is a git ref, taken by an atomic push

Status: proposed (step 0) · Specified in [03 Sync and lease](../spec/03-sync-and-lease.md)

## Context

The failure to avoid above all: a machine that was thought dead comes back and answers a thread that another
machine already continued. Two answers, two diverging states of the code. Something must say, at every moment,
which single machine may write to a thread, and it must work without a coordination server, because some users
have none.

Today the question is left open on purpose: `server/outbox.ts` marks an interrupted delivery `uncertain` and never
retries it, because nothing can tell whether the other side received it.

## Decision

The lease of a thread is the ref `refs/leases/<id>`: one commit holding `lease.json`. It is created with a push that
requires the ref not to exist, and replaced with a push that requires its current value (`--force-with-lease`).
Every push of thread content goes in the same `--atomic` push as a lease renewal. A lease in use can be taken by
another machine only after it has expired and has not changed for 150 seconds.

## Consequences

- At most one machine can extend a thread. This is enforced by the hub at every push, not by good behaviour.
- A machine that lost the lease finds out at its next push, whatever it believed. Its unpushed work is kept in an
  orphan ref and comes back as a note; it is never mixed in.
- No lock service and no clock service. Safety does not depend on clocks; only how fast a dead machine is replaced
  does.
- A machine that dies mid-turn is replaced after five to seven minutes, not at once. This is the price of not
  taking a thread from a machine that is only slow.
- A machine that works offline for longer than that loses its thread to another machine. Its work is kept but is
  not in the thread. Favouring "the thread always moves on" over "offline work always wins" is deliberate.
- A renewal is a push every 60 seconds per machine with work in progress.
- The hub must support atomic pushes. This is checked at setup.
