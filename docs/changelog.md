# Changelog

A short summary of what changed after the first working version.

## 2026-11-21

### Requests close on what shipped, not on what was said last
- A session often ships several requests in a few commits, and its last words are about something else: those
  requests stayed open, each with a part-filled bar. When a session stops, each request it holds is now checked
  against the commits that landed since it was sent (their messages, files and changed lines), on the repository's
  default branch, the branch checked out in its own folder, and any branch named in `WEEVILS_SHIPPED_BRANCHES` (a
  preview, a staging site). A commit that shows the request done closes it, the commit's id in its note; a session's
  word alone never does. A request at rest is read again when a later commit speaks of it (a merge made after the
  session stopped).
- A request whose only missing piece is yours (an answer, a restart, a merge) reads **needs you**, in words, in place
  of a bar, however long ago and even when its session is gone.

### Autonomous: automations can become factories
- The automations section is now called **autonomous**. Every automation's small repository says what it is: a
  readable manifest (name, purpose, schedule, scope, where it works), kept in step with the app and never the other
  way round: a commit cannot move a schedule or widen an authorization.
- An automation that earned it (10 runs, a week, 8 of its last 10 good, and used, pushed or proven) can become a
  **factory**: weevils says so once in For you, and a quiet line on its page unfolds onto **Unlock**. Only your own
  tap unlocks. A factory gets its own private GitHub repository with its whole history, its own icon, and its own
  page, drawn by weevils from the panels its manifest declares. Its schedule and rules do not change.
  Record: `docs/automations/PROTOCOL.md`.

### A new install opens straight into weevboss's chat
- No page before the conversation: until weevboss has said hello and a subscription is signed in, the app opens full
  screen in weevboss's thread, on every device and at every launch, ready to type (the home is one back away). The
  hello is shown being written, not preceded by a stand-in line. Hint bubbles, tip cards and the ghost finger wait for
  the end of that first run. In weevils next too, where weevboss's screen already is the first one: it now asks for
  the hello and has the question field of a setup (masked for a secret).
- Kept, outside the chat: the access-code screen, only when the app is opened without its login link (the server
  cannot be reached without it), and the setup chips and masked fields in the chat.

### Your conversations, on your own GitHub
- weevboss sets it up in its chat: one GitHub sign-in (a code typed on github.com), a 24-word recovery code given
  once, then one question about your history. Every Claude Code and Codex conversation of every machine is kept,
  encrypted, in a private repository of yours; a computer plugged in from weevboss's line keeps its own there too, and
  a new machine gets everything back from the recovery code. Record: `docs/spec/07-vault.md`.
- A conversation now continues on a machine that never ran it, from your GitHub alone: what the agent itself wrote
  (its reasoning included, long outputs shortened) and the state of the code at each turn are kept there too,
  encrypted, and fetched only for the conversation you continue (`weevils weevbook resume <thread>`). Nothing to set
  up: each machine gets its own access to the repositories by itself.

### Themes
- Two new themes in the theme selector: **desert** (désert), a light dusty desert (terracotta top, sage 24/7, sand,
  projects in powdered earth tones, a turquoise star); **synthwave**, a dark 80s neon night (violet-black bands,
  projects in the retro-sun gradient violet → pink → orange → yellow, a cyan star). Record: `docs/themes.md`.

### Automations land their work
- Safe automation output (a new theme, copy, an added image) merges into main by itself once its checks pass (run in
  the automation's own sandbox), then the running weevils rebuilds and For you says so. Everything else gets one line in
  For you, « … is waiting for your OK », and a **Land it** button: no work left stranded on a branch.
- Writing into a session an automation started (from the app, a For you tap, or weevboss passing on your request) makes
  that conversation an ordinary session of yours: same context, no new session, and it may merge and update weevils.
  Nobody else can take a closed automation session out of its sandbox. Record: `docs/automations/auto-merge.md`.

## 2026-11-20

### The first run is a conversation with weevboss
- No tour, no card, no button: weevboss speaks first, in the install's language, from what weevils already sees
  (projects, other machines, which subscription is signed in). Without one, Claude's sign-in link is in that first
  sentence and the code is pasted in the chat (kept from the model); Codex gets its device code the same way.
- Another computer plugs in from one line weevboss gives (`curl -fsSL <your weevils>/api/join.sh | bash -s <code>`):
  a one-time code, an SSH key held to the reverse tunnel's one port, then `install.sh --secondary`.
- ChatGPT and Claude.ai: asking weevboss turns the connector on at once and gives the address and the clicks.
- With agents asking before acting, weevboss makes a project's folder itself (`weevils project new`) and hands what
  needs a terminal (an install, a repo to create) to a session that asks in the app (`weevils do`).

### Safer defaults before going public
- Agents ask before acting on every install path (`WEEVILS_SAFE=1`); `--no-ask-permissions` lets them act without
  asking. An install that never chose switches on its next installer run (an automatic update counts) and says so.
- weevils never accepts Claude Code's bypass-permissions warning by itself, and answers "trust this folder?" only
  inside the project roots; elsewhere it is a question in the app. `skipDangerousModePermissionPrompt` is written only
  after an opt-out, and removed again (or at `--uninstall`) when weevils wrote it.
- A per-machine local token (`~/.local/share/weevils/local-token`, 0600) is required for a request from the machine
  to be trusted without the access code; the `weevils` command, the updater, Vite's dev proxy and federation send it.
- A git clone updates only to the main commit named in a signed release manifest (`/main.txt` + `.sig`), checked
  with the installed release key, and only when it descends from the current one.
- The setup page and the script say, before installing, that a computer's phone link makes it reachable from the
  Internet behind the access code, and how to avoid it (`--no-link`, Tailscale).
- `WEEVILS_PRIVATE_DIRS`: your own private folders, hidden from automations and the file explorer.

## 2026-11-17

### Bring your conversations
- Claude Code and Codex conversations from another computer, resumed here in one tap. Both tools keep a conversation
  only on the machine where it ran (one file each; neither account syncs local sessions). On a new machine, the first
  screen offers « bring my conversations from another computer », and weevboss can put the same button anywhere
  (`[[setup:history]]`): one line to paste in that computer's terminal (`server/bring.sh`: reads, sends, installs
  nothing), its 300 most recent conversations listed by title, a tap brings one. The project is found among the local
  clones or cloned (same git address), its folder paths are rewritten, and the conversation opens as a finished session
  that resumes with the next message. A machine already connected to this weevils (`WEEVILS_REMOTES`) lists its own
  without the line. Details: `server/bring.ts`.

## 2026-11-13

### macOS
- weevils installs and runs on a **Mac** (Apple Silicon and Intel) with the same command, by hand or through an AI
  agent (`AGENTS.md`). The installer runs under the bash 3.2 that macOS ships, never as root, and takes tmux, jq,
  Node.js and qrencode from **Homebrew** (installed too when it is missing). `--domain` is refused there (Caddy stays
  Linux only); `--url` and `--lan` work, and Tailscale is the way in for the phone.
- The service is a **launchd agent** of your session (`~/Library/LaunchAgents/com.github.sc4rville.weevilsd.plist`),
  started at login and restarted if it stops. `weevils-service start|stop|restart|status|logs` drives it as on Linux;
  logs in `~/.local/share/weevils/weevilsd.log`. Over SSH with no session open on the Mac's screen, weevilsd runs in
  the background until the next restart.
- Claude Code's login is read from the **Keychain**. weevilsd keeps the Mac awake while it is plugged in
  (`WEEVILS_KEEP_AWAKE=0` turns that off); a closed laptop lid still puts it to sleep.
- The install summary has two new keys, `os` (`linux` or `macos`) and `arch`. The systemd timers of the auto band and
  the bwrap jail stay Linux only. Details: [install.md](install.md#macos).

## 2026-11-10

### For you
- Next to weevboss at the top, a second word: **for you**, a stream of what the agents did, ask and suggest. One
  full-width band per item: a session's result (green), its question (amber) or why it stopped, a word from weevboss,
  a mail from an outside agent (unfolds in place), suggested automations as a carousel (✓ / ×), a way for weevils to
  serve you better, alerts, bold « did you know » about what is really in a repo, milestones, and bars that say where
  the day stands. Reply under an item, open the real conversation, launch an action: it slides out of the stream.
- The preview lives in the top band; a tap opens the stream full screen, with a line of participants to isolate
  weevboss, an outside agent, the sessions, the media or the ideas. The stream ends: « up to date ».
- **Media on purpose**: `weevils show <file> "caption"` (any session, or weevboss) puts an image or a video in the
  stream; files named in the last message of a turn join its result. Served by `GET /api/foryou/media/<id>` with
  `Range`, only for files the stream listed. `weevils post "…" [--action "label::brief"]` lets weevboss say a word
  there, with buttons.
- **Voice messages**: a word from weevboss or from an outside agent can be listened to, each speaker in its own voice.
- Generated items (weevboss's digest, ideas, insights) are written by weevilsd on a budget: only while the stream is
  being looked at, never past 85 % of a usage window, 60 model calls a day at most (plus, near Claude's limits, up
  to 120 through Codex and 16 short haiku lines). Plan and state: [foryou.md](foryou.md).
### Codex relay when Claude hits its usage limit
- weevilsd watches three signals, in plain code (no model call): the limit message Claude Code writes in a transcript
  (with its reset time), sessions that stop dead or API errors piling up, and the subscription quota read live (5-hour
  and weekly windows, the figures of the usage page).
- From 90 % of a window, Codex writes a **takeover plan** for every Claude session at work, read-only and in the
  background (`codex exec --sandbox read-only --ephemeral`), and one line says so, once per window (“you're at 90% of your week,
  I'm keeping Codex warm”); the next message is the switch, nothing in between. At 97 % (the limit has no grace period; the threshold is a setting, `WEEVILS_RELAY_AT` before any
  choice in the app) the switch is made ahead of the cut: weevboss answers through Codex (same folder, `AGENTS.md` =
  its instructions, same `weevils` command) and every working session is told to finish its step and stop. A limit
  seen after the fact opens the same episode.
- Each stopped session gets its plan (done, left, risks, what Codex intends to do), shown in one grouped view, under
  weevboss' thread and in the session's page: **approve**, **adjust** (Codex rewrites it with your note) or **wait for
  Claude**, one by one or all at once. Nothing is touched before the approval; approved, a Codex session opens in the
  same folder, linked to the Claude one (a small “relay” sign). Setting: propose a plan (default) / automatic / never.
- Background tasks of the auto band follow the same rule: on Codex only inside the bwrap jail (Codex has no deny
  list), otherwise they wait. At the reset time everything goes back to Claude: weevboss is told what Codex said in
  its place, sessions left to Claude are resumed, waiting tasks are released.
- `POST /api/relay` (mode, switchAt), `POST /api/relay/plans/:id|all` (go, adjust, wait), `POST
  /api/sessions/:id/relay` (ask for a plan). To try it on a throwaway server: `WEEVILS_FAKE_CLAUDE_USAGE=<file>`
  (a file shaped like the usage API's answer).
- Fixed on the way: an unclosed block in `src/styles.css` swallowed every rule written after it (inline setup chips,
  the language choices, masked secrets).

### Sessions cut off mid-work
- A session that dies while it was working (process or pane gone, tmux killed, crash), that stops on an API error
  (usage limit, expired login, failed compaction) or that stops without a clean end and leaves uncommitted work is now
  **interrupted**: a red row with a one-tap **resume**, a red counter in its project band (also when folded), a red
  band in its thread (resume / dismiss). Never shown as done, never with the green star.
- Each new interruption sends a push notification and posts a line in weevboss' thread; `weevils sessions` lists
  them first. Resume (`POST /api/sessions/:id/resume`, `weevils resume <id>`) restarts it with `--resume` and a message
  pointing it to its work on disk. A clean end (`/exit`, `/clear`, closed from the app, idle cleanup) is never one.
- Agent sessions now live on their own tmux server (`tmux -L weevils`; `WEEVILS_TMUX_SOCKET` to rename it): a
  `tmux kill-server` run by an agent no longer closes them. Sessions started before stay on the default server
  until they end; `wv ls` / `wv a` see both.

## 2026-11-09

### Open source
- No personal data in the code: one config file outside the repo (`~/.config/weevils/env`, template
  [`.env.example`](../.env.example)).
- English and French everywhere (app, server, installer, `wv`); the language follows the browser and can be changed
  in the bottom band. A test fails on any hard-coded user-facing string.
- One-command installer (`install.sh`) for a main or a secondary machine, optional HTTPS through Caddy, tested in
  blank Docker containers (`test/docker/run.sh`). See [install.md](install.md).
- First-run onboarding (three cards: a machine, a session, weevboss), replayable from the settings.
- Tips and action cards built from the real state (a session waiting for a while, idle sessions to close, a machine
  often maxed out…).
- First-tap hints: the first time you tap the voice logo, the green star, a project's `+` or `!`, or the 24/7 band (and the first time the repos page or conversation mode opens), a
  small flat bubble says what it is and what to do with it, once, remembered by the server for every device.
- `scripts/fresh.sh`: a blank install in an isolated Docker container, to see weevils as a newcomer; reset in one
  command.
- Ready for strangers: README rewritten (with captures of a blank install), MIT license, CONTRIBUTING, commented
  `.env.example`, `docs/email.md`. Settings that only made sense on one machine are now variables with neutral
  defaults (`WEEVILS_LOGS_DIR`, `WEEVILS_INBOX_DIR`, `WEEVILS_EXPOSE_SITES_DIR`, `WEEVILS_DISCOVER`, edge-tts voices).
  The hosting-provider lookup (ipinfo.io and a weekly web search) is off unless `WEEVILS_DISCOVER=1`.
- Security: a request counts as local (trusted without the code) only from 127.0.0.1 with no proxy header, a
  loopback Host and no Origin from another site or another local server, so a web page open on the machine or a DNS
  rebinding can no longer drive the agents. The permission-prompt trade-off (`WEEVILS_SAFE`) is documented.
- Installer: Linux checked first, WSL note, no useless QR code without a domain (the ways in are listed), `--lan`,
  Claude Code offered and its login checked, root keeps permission prompts, Caddy follows a port change, HTTPS
  checked at the end, `--uninstall [--purge]`; it no longer changes global Claude Code settings.
- Tests on the critical paths: sending, delivery and the session lifecycle (tmux layer, transcripts, status
  machine), hermetic (temporary HOME). Fixed on the way: a signed message to a Codex session was typed twice and
  reported as not received; a photo send left a duplicate "sending" bubble. `npm run check` = typecheck (app and
  server) + i18n + shell syntax + tests, ready for CI (`docs/ci/ci.yml`).
- Devil mode is turned on per device from the settings in the bottom band (shown when `DEVIL_API_URL` is set).

### weevboss, the orchestrator
- The top band is a chat with a dedicated Claude session (hidden from the projects) that has the `weevils` command
  (`sessions`, `read`, `send`, `new`, `projects`) and writes into the sessions itself. It can pick a GitHub repo,
  create a project, start or reuse a session, change a session's mode (`/model`, `/effort`…), and choose the machine.
- Three voices in every thread: you, weevboss (or another author), the agent.
- Calm by default: a general chat that grows to half the screen at most.
- Devil mode: another model behind an OpenAI-compatible API can join the same thread.
- External agents can write to the sessions by e-mail (authors + e-mail bridge, see [email.md](email.md)).

### Sessions
- The session page is the real conversation (you / the agent / what it is doing), in the project's color; the
  terminal screen is still there, folded, as a fallback. A pending question shows up in the thread with its answer keys.
- Stricter question detector: "your turn" only for a real dialog (dialog footer + options), no more false alarms.
- Short live titles: what the session talks about now (2–5 words) and what it does now (≤ 7 words), renamed
  periodically by an ephemeral `codex exec` on the subscription. A title set in the tool (`/rename`) always wins.
- Messages sent while the agent works (queued, mid-turn) show up in the thread.
- Sessions opened in a terminal that weevils cannot drive are hidden; done sessions are folded and limited to the
  most recent.
- A session outside any repo goes to the project it talks about; "misc" only when nothing matches.
- One-line session rows: tool sign (claude / codex, machine), current activity and its duration.

### Feed
- Living band order: projects with running agents move to the top (your turn > working > open > the rest by
  activity), with animation.
- Bright green spinning stars and breathing dots while an agent works.
- Faster thread: the last 60 messages first (the rest on demand), long user messages folded to 5 lines.

### Phone
- Photos in a session: resized on the phone (≤ 1600 px JPEG), dropped on the session's machine
  (`~/.local/share/weevils/inbox/`), the agent gets the path.
- Dictation (OpenAI transcription) in the sessions and in weevboss; spoken summaries.
- Installable app: add it to the home screen from Safari (Share → Add to Home Screen); enter the access code once
  in the app, then notifications become possible.
