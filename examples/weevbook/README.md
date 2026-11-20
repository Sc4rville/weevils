# weevbook

This repository holds conversations with AI tools, one folder per thread. weevils writes it; you can read it.

- `projects/<project>/<year-month>/<id>-<title>/` is one thread. `_unsorted` holds threads without a project.
- `index.json` lists the threads and the commit each folder was taken from.
- `thread.md` is the thread as you would read it.
- `events.jsonl` is the journal: one event per line, only ever appended. It is the truth; the other files are
  rebuilt from it.
- `meta.json` is a summary of the journal: title, project, state.
- `handoff.md` is what another agent needs to continue the work.
- `attachments/` holds the files of the thread, named by their SHA-256.
- `raw/` holds the lines the AI tool itself wrote, kept to resume the thread on another machine.

Do not edit these files by hand: `main` is rebuilt from one git ref per thread (`refs/threads/<id>`).
Text that looks like a password or a key is replaced by `[redacted]` before it is written here.

Format: https://github.com/Sc4rville/weevils/tree/main/docs/spec
