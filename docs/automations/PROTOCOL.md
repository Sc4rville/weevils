# Autonomous: automations

The protocol for everything in weevils that runs on its own. It is shared product behaviour: the same for Claude and
Codex, for every installation, in every theme and both languages. It names what already exists, adds what was
missing, and fixes the conventions. Where this page and the code disagree, this page changes first, once, and the
code follows.

Related: [automation software lifecycle](../product/automation-software.md) (source adoption, pins, deletion),
[what merges on its own](auto-merge.md), the playbooks beside this file (`night-lens.md`, `repo-hygienist.md`).

## 1. Words

| Word | Meaning |
|---|---|
| **Autonomous** | The section of the app that lists what runs on its own. It replaces the label « Automations ». |
| **Automation** | A job the person approved once, that then runs by itself inside its rules (its *standing authorization*). |
| **Mother** | The folder `<projects>/automations/` that holds every automation's source. |

Internal names stay as they are (`Optimizer`, `/api/optimizers`, `/api/auto`, `h24`, `auto/…` branches): renaming
them would break running installs for no gain. Only what a person reads changes.

## 2. What exists, what this adds

| Area | Already there (kept) | Added by this protocol |
|---|---|---|
| Source | One local Git repository per automation, a registry, pinned snapshots that actually run | A human `name`, a manifest that says what the automation is (schema 2) |
| Rules | The scheduler's record: schedule, scope, target, pause; jail and deny list | A read-only mirror of them in the manifest; the rule that the mirror never drives |
| Runs | Report file, last words, changed files, links, images, archive per run | An optional run card (`run.json`): a summary line, numbers, results |
| Results | Branch + auto-merge or « Land it »; weevils pages; For you posts; the « Automation results » page | A declared results page per automation, opened from its page |
| App | The automations drawer (classic), the Automations section (next), one page per automation | The label « Autonomous » |

## 3. The mother folder

```
<projects>/automations/              the mother (marker: .weevils-owner.json)
  README.md                          what this folder is, for a stranger (written once, yours to edit)
  registry/                          a Git repository: one small file per automation (id → folder, kind, name)
    automations/<id>.json
  projects/auto-<id>/                one Git repository per automation, with its history from day one
  .versions/<id>/<commit>/           read-only snapshots: the exact source a run executes
```

- The folder name stays `auto-<id>`: the id never changes, so a rename of the automation breaks nothing. The human
  name lives in the manifest and in the registry.
- The mother itself is not a Git repository and there are no submodules (unchanged).

## 4. One automation = one small repository

```
automation.json        the manifest (section 5)
README.md              what it is, for a stranger
PLAYBOOK.md            optional: the method the agent follows on every run
src/run.mjs            the entrypoint; the scheduler runs `node src/run.mjs -- <provider command>`
src/*.test.mjs         its tests: `node --test src/`
config.example.json    the names of its parameters, never their values
.gitignore             state/, outputs/, .env*, *.log, node_modules/
```

- **Never in Git:** secrets, local paths, host names, run outputs, conversation text, the private brief.
- **The method is versioned, the brief is a pointer.** A method worth keeping lives in `PLAYBOOK.md`, or in the
  project the automation works on (`docs/automations/<name>.md`) when the method is about that project. The stored
  brief then only says « read your playbook ». Changing the method is a commit.
- **The entrypoint may grow.** It starts as a plain adapter that passes the agent's command through. It can take
  over deterministic steps (decide a quiet night, publish a file once). Only a committed revision is ever run.
- Commits: `type(scope): what and why`, as everywhere in weevils.

## 5. The manifest (`automation.json`, schema 2)

```json
{
  "schemaVersion": 2,
  "id": "a1b2c3d4e5",
  "kind": "automation",
  "name": "night-lens",
  "title": "Night lens",
  "purpose": "Looks at the app every night as a newcomer would and proposes what to simplify.",
  "owner": { "repo": "my-app" },
  "schedule": { "trigger": "sleep", "every": "24h", "window": "01:00-05:00" },
  "scope": "Readability fixes and proposals for the app; nothing published outside this machine.",
  "entrypoint": "src/run.mjs",
  "steps": [{ "id": "agent-task", "type": "agent", "instructions": { "configuration": "optimizer", "id": "a1b2c3d4e5", "field": "prompt" }, "target": { "configuration": "optimizer", "id": "a1b2c3d4e5", "field": "repo" } }],
  "playbook": { "in": "owner", "path": "docs/automations/night-lens.md" },
  "results": { "page": "report/night-lens" },
  "metrics": [{ "key": "proposals", "label": "Proposals" }],
  "runtime": { "configuration": "installation", "state": "outside-source", "secrets": "references-only" }
}
```

| Field | Meaning | Written by |
|---|---|---|
| `id` | Stable identity, never reused | weevils, once |
| `kind` | `automation` | weevils |
| `name` | Lowercase slug, unique in the mother | weevils, from the title; kept when the title changes |
| `title`, `purpose` | What the person reads: its name, its job in one sentence | mirror of the scheduler's record |
| `owner` | The repository it works in; `null`: its own workspace | mirror |
| `schedule` | `trigger`: `every`, `window`, `time`, `idle`, `sleep`; `every` (`3h`, `24h`, `7d`); `window` (`HH:MM-HH:MM`); `at` (ISO date) | mirror |
| `scope` | The standing authorization, one plain sentence | mirror |
| `entrypoint`, `steps`, `runtime` | Unchanged from schema 1 | weevils / the source's author |
| `playbook` | Where the method is: `{ "in": "source" \| "owner", "path" }` | the source's author |
| `results` | `page`: the weevils page its results live on (`<kind>/<slug>`) | the source's author, or weevils when a run publishes one |
| `metrics` | The numbers its runs report: `key`, `label` (a string, or `{ "en", "fr" }`) | the source's author |

**The mirror never drives.** The schedule, the scope, the target and the pause live in the scheduler's record
(private installation storage) and change only through the app: a talk, then the person's ✓. weevils copies them
into the manifest so the repository says what it is. An edit of `title`, `purpose`, `owner`, `schedule` or `scope`
in Git changes nothing that runs, and the next sync writes the live values back. No commit, by anyone, can widen an
authorization or move a schedule.

Unknown fields are kept and ignored. A schema 1 manifest still runs (section 8).

## 6. How a run reports

A run leaves, beside its work (never inside the branch):

| What | Where | Read as |
|---|---|---|
| The report | the report file named in its brief (`<id>.md` beside the worktree, or `report.md` in its workspace) | prose; its first line is the headline |
| The run card (new, optional) | `<id>.run.json` beside the report (`run.json` in a workspace) | `{ "summary": "one line", "metrics": { "proposals": 3 }, "page": "report/night-lens" }` |
| Its last words | the session's last message | fallback headline |
| Its changes | the diff of its branch since the run started | files, +/− |
| Links and images | found in the report and the last words; images copied (6 at most) | the run's page |

- `ok` is the scheduler's verdict (the entrypoint's exit status and the supervisor), never the report's own claim.
- `metrics` are numbers only, keyed as declared in the manifest; undeclared keys are kept but not shown.
- weevils stores the summary, the numbers and the page on the run's line. A run with no card is a normal run.
- A run never says its work is live: weevils says so itself when it landed.

## 7. How results land

1. **Work on a repository** goes to the automation's own branch (`auto/<slug>-<id>`), pushed by weevils. Inside its
   scope and green, it lands on main by itself; otherwise one line in For you with **Land it**
   ([auto-merge.md](auto-merge.md)).
2. **Something to look at** (leads, a report, a library) lives on a weevils page with a stable title and kind, so its
   address never moves: `weevils page <file|folder> "<title>" --kind <kind>`. The manifest names it in
   `results.page`; the automation's page opens it with one living link.
3. **Something to say**: at most one For you post per run, only when it is worth reading, with honest evidence flags
   (`--demonstrated`, `--verified`, `--limit`). Buttons only for what stays the person's call.
4. **The history** of every run stays on the « Automation results » page.

## 8. Moving existing automations to schema 2

Additive, automatic, at server start, after source adoption:

- Only an adopted automation that is not running, with a clean source tree, is touched; the others wait.
- weevils adds the new fields to `automation.json` (name, title, purpose, owner, schedule, scope, and the results
  page when a run already published one) and commits (`chore(manifest): schema 2`). Nothing is removed.
- The pinned source moves to that commit **only when the commit changed nothing but the manifest and the README**
  (checked with Git): the code that runs is byte-identical.
- The scheduler's record is not modified: schedule, time zone, scope, pause, target, state, history and
  conversations are read, never written. A test compares them before and after.
- Going back: select the previous revision (`POST /api/auto/:id/source`); the existing adoption rollback still
  switches every automation to the legacy runner.

## 9. For agents (Claude and Codex)

- You never edit the mirrored fields to change behaviour.
- In a run: write the report, and the run card when you have numbers; publish results on the declared page; one For
  you post at most; never push, never claim « live ».
- Changing an automation's method: commit to its playbook or its source, then select the revision. Changing its
  schedule or scope: a talk on its page, accepted by the person.

## 10. API (additions)

`Optimizer` gains `name`. `AutoRun` gains `summary`, `metrics`, `page`.
