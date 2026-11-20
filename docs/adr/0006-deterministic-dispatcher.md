# ADR 0006 · The dispatcher is a table, not a model

Status: proposed (step 0) · Specified in [06 Dispatch](../spec/06-dispatch.md)

## Context

Every message needs an engine. The choice depends on which machines are on, which accounts are signed in where,
how much quota is left and where the thread ran before. It must be made in milliseconds, also when every provider
is at its limit, and it must be explainable afterwards when someone asks why a thread went where it went.

## Decision

The dispatcher is plain code: a decision table read top to bottom, over an engine table that machines publish. It
calls no model. Each decision is written in the journal with the rule that matched and the facts it used. A
simulator runs the reference scenario with random failures and checks the same invariants after every run.

## Consequences

- It works when no model is available, which is when it matters most.
- The same inputs give the same engine. A decision can be replayed from the journal and tested row by row.
- It cannot judge that a task "would suit" one provider better. It only knows availability, room and continuity.
- Filing a new thread under a project uses the rule only. A model may re-file it later, off the message's path.
- Thresholds are constants to tune. They are few, and the simulator shows what a change does.
- The user has no setting to understand. The modes and thresholds of today's Codex takeover go away.
