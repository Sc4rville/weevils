# Automation software lifecycle

This is shared product behavior for Claude, Codex and every installation. It does not depend on personal memory.

## Delete the automation, keep its work

`DELETE /api/auto/:id` (also `/api/optimizers/:id`) deletes a managed optimizer, not a repository.
The server persists a tombstone before success; repeated deletion is idempotent. Normal lists/details hide it
across reload. Existing source, configuration, conversations, outputs and run history remain available on disk.
Future triggers, queued starts, retries and relay starts are canceled. A run that already started finishes
in its original workspace, stays monitored and is archived once; it cannot schedule another run. A launch
still preparing its worktree is canceled before spawning an agent. A storage failure is an error, not success.
External systemd timers and log-discovered jobs are not silently deleted or adopted as scheduler-owned objects.

## Independent local repositories

The first user-created draft and retroactive adoption create `<configured project root>/automations/`:

- `registry/` is a local Git repository with relative ID-to-source references.
- `projects/auto-<stable-id>/` is an independent local Git repository for each automation.
- The parent folder is not a Git repository; there are no nested Git repositories or submodules.
- `.versions/<id>/<commit>/` holds immutable execution snapshots, separate from editable source.

Each source has a README, versioned manifest, configuration example, ignore rules and executable
`src/run.mjs`. Existing agent workflows are adopted as an explicit `agent-task` step adapter: it launches
the scheduler-supplied provider command, propagates status/signals and preserves the existing sandbox.
Their private title/purpose/instructions and target are local configuration referenced by manifest ID,
not copied into Git. This is a compatibility adapter, not an assertion that old agent workflows have
already been rewritten into deterministic domain-specific programs. The source can evolve to implement
the workflow directly through its entrypoint; only a committed compatible revision is promoted.
No model request or autonomous worker is required to create/adopt a repository.

The registry and sources contain only generated known files, with no local paths, hosts, credentials,
conversation text or arbitrary legacy files. Existing legacy code/output directories are preserved as
private runtime bindings and explicitly reported in `software.excluded` if present, not blindly committed.
There is no automatic remote creation or push. Existing Auto publication restrictions remain; GitHub
login alone is not authorization to create/publish repositories. A future remote policy must explicitly
cover owner, creation, push and visibility.

## Migration, version binding and recovery

On startup and on new creation, `Optimizers.adoptAll()` reconciles all stored objects, including old
refused/deleted ones. It makes a mode-600 backup of the original optimizer state before the first adoption.
Each object retains its original ID, schedule/timezone, state, conversations, runs and target workspace.
Provisioning is serialized and recorded by owned markers; retries reuse the same path/ID and commit.
Path collisions fail closed and retain the original folder. A dead process's complete provisioning lock
can be recovered; an incomplete/ambiguous lock requires review rather than overwriting unknown work.

A running legacy job receives `pending-running` source metadata without scanning or changing its directory,
version, process or schedule. Its old run is never falsely labeled with a source revision. After completion,
reconciliation marks it ready. Future runs execute the pinned software entrypoint inside the existing
sandbox and keep the old target/output workspace: source handoff does not require moving live files.
The run records `softwareId`, `sourceRevision` and a hash of its private configuration; secret values are
not archived as configuration snapshots. Changing a selected revision affects future runs only.
A provider unavailable or sandbox failure continues to follow existing Auto failure/retry rules.

`GET /api/auto/adoption` exposes counts, errors and per-object bindings. This is engineering metadata;
it does not publish cards or vocals. `POST /api/auto/:id/source` with a full committed revision validates
identity/entrypoint and pins its files before selecting it. Dirty source is never executed. Symlinks,
submodules, invalid paths and oversized source trees are rejected. Selecting a previous revision is source
rollback; mutable state is never reverted blindly. Stateful upgrades still need explicit compatible data
migration, which this adoption does not perform.

`POST /api/auto/adoption/rollback` durably switches future launches back to the existing legacy runner.
It preserves all source repositories, active jobs, schedules, new user edits/deletions and histories; it does
not replace a live state file with an old backup. The original backup remains for inspected recovery.
Adoption stays disabled after restart following that rollback. No automation is run or deleted as migration QA.

Current scope covers the optimizer objects owned by Auto. External timers/jobs remain observed in place;
if present they require a separately validated owner/entrypoint mapping before changing their scheduler.
They are not claimed as migrated by this API's counts. There were zero such objects in the inspected live inventory.
