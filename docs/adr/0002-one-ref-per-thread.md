# ADR 0002 · One git ref per thread, and a composed `main`

Status: proposed (step 0) · Specified in [03 Sync and lease](../spec/03-sync-and-lease.md)

## Context

With one branch for the whole weevbook, every turn of every thread is a commit on the same branch. Two machines
working on two different threads would reject each other's pushes all day and have to merge, although they never
touch the same file. The reference scenario has three accounts and two machines at work at once.

## Decision

Each thread has its own ref, `refs/threads/<id>`. Its tree is the thread's folder with fixed file names at the root.
Only the lease holder of that thread pushes to it, always fast-forward. `main`, the branch people browse, is
composed from the thread refs: each thread's tree is placed at `projects/<project>/<YYYY-MM>/<id>-<slug>/`.

## Consequences

- Two threads never conflict. There is no merge anywhere in the system.
- The folder name, which holds the title and the project, exists only in `main`. Renaming a thread or filing it
  elsewhere rewrites nothing in the thread's own history.
- `main` is a view. It can be deleted and composed again; it is never read as truth.
- Composing costs one extra commit and push after a turn. Trees are reused, so no file is copied.
- A plain `git clone` gets `main` only, which is what a reader wants. weevils fetches the other refs itself.
- Thread refs have no title in them, which keeps encryption for foreign hubs possible later (open decision D2).
- The hub must accept refs outside `refs/heads`. Bare repositories and the large git hosts do.
