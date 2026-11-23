# The onboarding lab

A dev tool for whoever builds weevils: play a newcomer through the real onboarding, and change the onboarding while
playing it. Nothing of it runs in a normal install (it needs `WEEVILS_LAB_DIR`, set only by `scripts/lab.sh`).

- `scripts/lab.sh up --url https://lab.example.com` makes a worktree on the branch `lab/onboarding` (from `main`),
  builds it, starts a blank instance whose code is that worktree (Claude not signed in, a lent sign-in for questions,
  as `scripts/fresh.sh up --guest-claude`) and the watcher (`scripts/lab/watch.mjs`), then prints the link that signs
  the phone straight in.
- On weevboss's screen, a small green dot sits on the field's corner. **Off**: you are the newcomer, everything goes
  on as for anyone. **On**: the field turns green and what you send (typed, dictated, a capture from the camera) is a
  remark about the onboarding, with the last lines of the screen. The dot pulses while it is being made.
- The watcher hands the remark to an agent (Claude Code, Opus by default) in the worktree: it changes the words, steps
  or screens and their tests. Then types, words in both languages and the tests near the change are checked (one more
  try when a check fails, else nothing is kept), the app is built, the change committed on `lab/onboarding`, and the
  instance restarted on it.
- weevils then plays the last step again with the new code (`Setup.restep`: the state just before the hello, the
  message before the sign-in, or the link tapped) and the page reloads where you were. A step that went to weevboss's
  model is not played again: the change shows from the next step.
- With the dot on, the remarks sit above the field: what you said, what changed (green; red when nothing could be
  kept). **undo** reverts one change; **keep** runs every check and test, then fast-forwards `main` with the lab
  branch (refused when main moved in a conflicting way); **start over** gives a blank instance, the phone still signed
  in.
- Files only between the instance and the watcher, in the lab folder (`~/.local/state/weevils-lab`): `remarks/`
  (written by the instance, `server/lab.ts`), `results/` (by the watcher), `requests/` (undo, keep, start over);
  `watch.log` says what the watcher did.
