# Repository hygiene

How this repository stays clean enough for a stranger to clone, read and trust. The rules below are maintained by
the « Repo Hygienist » automation (method: `docs/automations/repo-hygienist.md`), which applies them every run,
cleans what is safe, proposes the rest and invents a new rule when its findings justify one. Humans may edit this
file too: a rule changed here applies from the next run.

## Rules

| Id | Rule | Why | Checked by |
|---|---|---|---|
| H-1 | No secret and no personal trace of a machine (owner e-mail, name, home path, hostname, private domain) in the shared source or in new history. Fixtures use `/home/user` and `user@example.com`. | This repository is the open-source distribution. | Section 2b of the method, over `scripts/release.py export`. |
| H-2 | Never edit a file another session or branch is working on (dirty in a worktree, on a branch active in the last 72 h, or in a working session's folder). | Hygiene must never collide with live work. | The hot set, section 1. |
| H-3 | A cleanup reaches `main` only when `npm run check && npm run build` is green on top of the current `main` and the tests leave no file behind. | A green branch on an old base proves nothing. | Section 4. |
| H-4 | Deleting real code (more than 40 lines, or a whole source file), branches or history is always a proposal, never a silent fix. | Recoverable mistakes only. | Triage, section 3. |
| H-5 | Unused exports, files and dependencies are removed only when both knip and a plain text search find no reference, docs and scripts included. | Static analysis misses dynamic and documented entry points. | Section 2, dead code. |
| H-6 | No tracked log, temp file, merge leftover, coverage or test report; generated output stays ignored. | Junk in a public repo reads as neglect. | Section 2, artifacts. |
| H-7 | Tracked files stay under 500 KB unless listed as an exception; source files over 1,500 lines are flagged for splitting. | Clone size and readability. | Section 2, sizes. |
| H-8 | Every command, path, env var and link in the docs exists in the code. | Outdated docs cost newcomers the most. | Section 2, docs vs behavior. |
| H-9 | No known high or critical vulnerability in dependencies stays unreported for more than one run. | Safety of everyone who installs weevils. | `npm audit`, every run including quiet ones. |
| H-10 | Copies of this repository (mirrors in `~/projects/.mirrors`) are compared, never synced, by the automation. | Decision of 2026-11-12: one canonical source. | Section 2c. |

## Accepted exceptions

Deliberate choices the automation must not report again. One line each: what, why, who decided, date.

- `harness-interface-kit/` and the other paths excluded in `scripts/release-policy.json` are local or private by
  policy: not part of the shared selection, not scanned as shared source.

## Retired rules

None yet.

## Changelog

Newest first, last 10 runs (older ones in `docs/hygiene/history.md`).

- 2026-11-14 · set up · rules H-1 to H-10 written from the owner's brief; no run yet.

<!-- hygiene:last-full none -->
