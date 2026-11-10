# Installing weevils for your user

You are an AI agent (Claude Code, Codex…) and your user asked you to install weevils, for example
"install https://github.com/Sc4rville/weevils". Follow these steps in order. Everything runs without questions;
your user hears from you once, at the end, unless a step below says to ask.

(Asked to work on weevils' code instead? Skip this file and read [CONTRIBUTING.md](CONTRIBUTING.md).)

What it is, for your final message: weevils is an app on the user's phone to watch and drive the Claude Code and
Codex sessions running on this machine, with an assistant called weevboss at the top.

## 1. Check the machine

- `uname -s` must print `Linux` (a VPS, a home server, a desktop, or WSL2 on Windows). On macOS, stop: tell the user
  weevils runs on Linux only for now (a small VPS or WSL2 works) and install nothing.
- A regular user with sudo is best. Root works, but agents then keep their permission prompts.
- Install nothing yourself first: the installer adds what is missing (git, tmux, jq, Node.js 22, Claude Code…).

## 2. Get the code

Already inside a clone (`install.sh` and `server/` next to this file)? Stay there. Otherwise:

```sh
git clone https://github.com/Sc4rville/weevils ~/weevils && cd ~/weevils
```

If `~/weevils` already exists, `cd ~/weevils`: the installer updates it. Use `git clone`, not `curl | bash`.

## 3. Pick the options

- `--lang fr` if the user writes to you in French, else `--lang en`.
- `--name <first name>` only if you know it for sure (they told you). Never ask just for this.
- How the phone reaches the machine, at most one, only when you know it applies:
  - `--domain <host>`: the user told you about a domain that points to this machine (HTTPS through Caddy; needs sudo
    and ports 80/443 open).
  - `--url <https://…>`: something else already serves HTTPS to this machine and forwards to weevils' port
    (Tailscale serve, their own reverse proxy).
  - `--lan`: the user wants plain http on their home Wi-Fi. Never on a VPS.
  - none: fine, step 6 decides.
- A re-run keeps the earlier settings: pass only what changes.

## 4. Run the installer

`--agent` means: no questions, no colours, sudo only when it needs no password (never a prompt that hangs), and a
summary block at the end. It takes 2 to 10 minutes on a blank machine, longer than most tool timeouts, so run it in
the background:

```sh
cd ~/weevils && nohup ./install.sh --agent --lang <fr|en> [options from step 3] > ~/weevils-install.log 2>&1 &
```

Then wait for the summary, in checks of under a minute each, until the log ends with `--- end ---`:

```sh
timeout 50 sh -c 'until grep -q "^--- end ---" ~/weevils-install.log; do sleep 5; done'; tail -n 45 ~/weevils-install.log
```

The summary is `key=value` lines between `--- weevils summary ---` and `--- end ---`:

| key | meaning |
|---|---|
| `status` | `ok`, `needs_sudo` or `failed` (then `error` says why) |
| `url`, `code`, `link` | the address the phone opens, the access code, and the login link `<url>/#k=<code>` |
| `mode` | `public` (HTTPS from anywhere), `lan` (same Wi-Fi, http), `local` (this machine only) |
| `https`, `port` | `yes`/`no`; the local port weevils listens on (127.0.0.1) |
| `ready` | `yes` when Claude Code is installed and logged in |
| `claude_installed`, `claude_logged` | Claude Code (required: weevboss runs on it) |
| `codex_installed`, `codex_logged` | Codex (optional) |
| `gh_installed`, `gh_logged`, `gh_login` | GitHub CLI (optional) |
| `projects` | Claude Code projects with a session in the last 3 days: the app shows them at once |
| `projects_all`, `repos` | all Claude Code projects; git repos in `~/projects` |
| `tailscale`, `tailscale_name` | Tailscale installed; this machine's `…ts.net` name when it is connected |
| `laptop`, `wsl`, `sudo` | `yes`/`no`; `sudo` is `yes`, `password` (you can't use it) or `no` |
| `qrencode` | `yes` when you can draw a QR code (step 7) |
| `needs`, `retry` | with `needs_sudo` only: what needs root, and the command that does it all from a terminal |
| `handoff` | the file the app reads to start its tour where you stopped (`~/.local/share/weevils/install.json`) |

- `status=needs_sudo`: sudo wants a password you can't type. Ask the user, in one sentence, to run the `retry`
  command once in a terminal of their own (it asks for their password and finishes the install), then tell you.
  This is the only command you ever give them. When they are done, run step 4 again to get the summary.
- `status=failed`: read `error` and the lines above it. Fix the cause if it is clearly yours to fix, run once more,
  otherwise tell the user what went wrong in plain words.

## 5. Don't redo what's ready

Trust the summary; don't re-check by hand.

- `claude_logged=yes`: Claude Code works, leave it alone. `no`: the user has to log in once (a browser login you
  can't do for them): ask them to type `claude` in a terminal and follow the steps.
- Codex and GitHub are optional: don't install them or log in for the user. weevboss offers them in the app later.
- `projects` and `repos` are already in the app: say so in your final message.

## 6. Phone access

From `mode`:

- `public`: done, the link works from anywhere.
- `lan`: works on the same Wi-Fi only (no microphone, no notifications over http).
- `local`: the phone can't reach it yet. In this order:
  1. `tailscale_name` is set: run `sudo -n tailscale serve --bg <port>` (or `tailscale serve --bg <port>` if the user
     is the Tailscale operator), then step 4 again with `--url https://<tailscale_name>`. The phone needs the
     Tailscale app, logged in to the same account.
  2. Otherwise ask the user one plain question, no commands, for example: "To open it on your phone, weevils needs a
     way in: do you have a domain name pointing to this machine, or should I set up Tailscale (free: a private link
     between your phone and this machine)?" Then do the work yourself if they agree:
     - a domain: step 4 again with `--domain <host>` (HTTPS is set up for them).
     - Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh` and `sudo tailscale up` (both need sudo without
       a password; otherwise this is a `retry`-style command for the user). `tailscale up` prints a login link: give
       it to the user, wait until they say it's done, then do 1. If `tailscale serve` prints a link to enable HTTPS
       on their tailnet, give them that link too.
  3. Nobody to ask (a one-shot run): set nothing up. End with the local link and that one sentence.

## 7. The final message

In the user's language, in plain human words: no jargon, no command for them to run. Short:

1. It's installed (or, if `ready=no`, what one thing is left).
2. The link to open on the phone: `link` from the summary. It contains the access code, which logs them in: treat it
   like a password.
3. A QR code, when `mode` is `public` or `lan` and `qrencode=yes`: run `qrencode -t UTF8 -m 2 '<link>'` and paste
   its output unchanged in a code block. Never draw or retype a QR code yourself.
4. Add it to the home screen: iPhone: Share → Add to Home Screen; Android: ⋮ → Install app.
5. What's already there and the first thing to try: open the app and write to weevboss in the field at the top,
   "what are my projects up to?" when `projects` > 0, otherwise "make me a small notes app".
6. `mode=local`: the one-sentence explanation from step 6 instead of 2–4, with the link for a browser on this machine.

Template (English, public):

> weevils is installed. On your phone, open this link (it contains your access code, so keep it to yourself):
> https://weevils.example.com/#k=AbC123xyz
> *(QR code)*
> Then add it to your home screen (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app).
> Your 12 Claude Code projects are already in it. To start, write to weevboss at the top: "what are my projects up to?"

Template (French, local):

> C'est installé, mais ton téléphone ne peut pas encore l'ouvrir : pour l'instant weevils n'est joignable que depuis
> cette machine (http://localhost:4179/#k=AbC123xyz dans un navigateur ici). Il lui faut un chemin : tu as un nom de
> domaine qui pointe vers cette machine, ou je mets en place Tailscale (gratuit : un lien privé entre ton téléphone
> et cette machine) ? Dis-moi et je m'en occupe.
> Ensuite, sur ton téléphone : ouvre le lien, ajoute-le à l'écran d'accueil (iPhone : Partager → Sur l'écran
> d'accueil ; Android : ⋮ → Installer l'application), et écris à weevboss en haut : « fais-moi une petite app de notes ».

## Don't

- Leave a sudo prompt hanging: use `sudo -n`; when it needs a password, see `needs_sudo` above.
- Print, log or repeat secrets: the access code, keys in `~/.config/weevils/env`, tokens. The one exception is the
  login link, once, in your final message.
- Edit `~/.claude/settings.json` or `~/.config/weevils/env` by hand: the installer adds the hooks and settings.
- Change systemd units, crontab, Caddy or the firewall beyond what the installer does; start weevils by hand.
- Run `./install.sh` without `--agent`: it would wait for answers or take every question as no.
