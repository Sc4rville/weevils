# ADR 0004 · The handoff is kept current, not written at the moment of failure

Status: proposed (step 0) · Specified in [04 Resume](../spec/04-resume.md)

## Context

To continue a thread on another provider, the new engine needs a handoff: the goal, what is done, the decisions,
how to run the code. The best writer of that text is the engine that did the work. But the moments when a handoff
is needed are exactly the moments when that engine cannot be asked: its usage limit is reached, or its machine is
off.

Today `server/relay.ts` asks Codex to write a plan for each working session when Claude's quota passes 90 %. That
covers the limit and nothing else, and the plan is written by the engine that knows the work least.

## Decision

After every finished turn of an active thread, the engine that did the turn rewrites `handoff.md` in the
background with its provider's small model. The file has a fixed shape. When no model can be asked, it is completed
from the journal by plain code. On a change of provider the new engine also receives the events after the
handoff's `upTo` and the last exchanges word for word.

## Consequences

- When something stops, the handoff is already there, at most one turn old.
- It costs a small model call per turn, on the user's quota. This is open decision D3; the alternative is a handoff
  built only from the journal, which is free and worse.
- A fixed shape can be checked by code, and a broken rewrite is thrown away.
- A late handoff costs words, not facts: the events after `upTo` are always added.
- The preparation at 90 %, the plans to approve and the three modes of today's Codex takeover have no reason to
  exist any more.
