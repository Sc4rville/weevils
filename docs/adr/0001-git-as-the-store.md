# ADR 0001 · Git is the store

Status: proposed (step 0) · Specified in [02 Weevbook](../spec/02-weevbook.md), [03 Sync and lease](../spec/03-sync-and-lease.md)

## Context

A thread must outlive the machine and the provider it started on. It needs a store that several machines write to,
that keeps working offline, and that a curious person can open and read. Today threads are provider files on one
machine (`~/.claude/projects`, `~/.codex/sessions`), and imported chats are rows in SQLite
(`server/conversations.ts`). Neither travels.

Options considered: a database on the main machine served over the existing link between machines
(`server/remotes.ts`); a synced folder; a git repository.

## Decision

The weevbook is a git repository of text files. The journal of each thread is an append-only JSON Lines file. Its
remote is the hub. Every install already has git, and the installer already checks for it.

## Consequences

- Sync, history, integrity (content hashes) and offline work come from git, not from code we write.
- A hub is any git host the user owns: a bare repository on their server, or none at all on a single machine.
- The files can be read on any git web view, with no weevils running.
- The same git push that carries data can carry the lease ([ADR 0003](0003-lease-by-atomic-push.md)).
- Git has no access control inside a repository: a weevbook is one person's. Sharing is out of scope.
- Git keeps everything. Deleting a thread for good means rewriting that thread's ref; this is specified later.
- Raw provider lines make the repository grow by megabytes per long thread. They are stored uncompressed so that
  git can store only the difference between two versions.
- A database remains fine as a local index for search. It is rebuilt from the weevbook and is never the truth.
