# Installing weevils

One command on a Linux machine or VPS (Ubuntu/Debian tested; dnf and pacman supported for packages).

```sh
git clone https://github.com/Sc4rville/weevils && cd weevils && ./install.sh
# once the repo is public:
curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh | bash
```

Run it again any time: it updates (git pull, npm ci and build only when something changed) and keeps your settings.

## What it does

1. Checks the system and installs what is missing (with sudo, after asking): git, curl, tmux, jq, python3,
   Node.js >= 22.18 (NodeSource), plus `dbus-user-session` on systemd machines and `qrencode` for the QR code.
   Claude Code / Codex are only checked: if neither is there it tells you how to install them.
2. Clones weevils into `--dir` (default `~/weevils`) when piped from curl, or uses the clone it runs from.
3. Writes your settings to `~/.config/weevils/env` from `weevils.env.example`. Values already there are kept;
   a flag you pass (`--name`, `--lang`, `--port`, `--domain`, `--machine`) updates its key.
4. `npm ci` and `vite build`.
5. `server/install.sh`: commands in `~/.local/bin` (`wv`, `weevils`, `weevils-service`, `weevils-hook`), the Claude
   Code hooks, and the service — a `systemd --user` unit with linger (survives logout and reboot), or a background
   process where there is no systemd (containers, WSL), controlled with `weevils-service start|stop|status|logs`.
6. With `--domain`: Caddy (official apt repo) and a site in `/etc/caddy/weevils.caddy`, imported from your
   Caddyfile (an existing Caddyfile keeps its sites; a backup is kept in `Caddyfile.bak-weevils`).
7. Prints the address, the access code, the login link (`…/#k=<code>`) and its QR code.

## Options

| option | |
|---|---|
| `--yes` | no questions, defaults everywhere |
| `--name <first name>` | how the agents call you |
| `--lang en\|fr` | language of the installer and of the server (default: your locale) |
| `--domain <host>` | HTTPS through Caddy; the domain must point to the machine, ports 80/443 open |
| `--port <n>` | port of weevilsd on 127.0.0.1 (default 4179) |
| `--dir <path>` | install directory when piped from curl (default `~/weevils`) |
| `--secondary <ssh-host>` | a second machine: see below |
| `--machine <id>` | id and name of this machine (default: hostname) |
| `--no-update` | no git pull |

Without `--domain`, weevilsd listens on 127.0.0.1 only. Reach it with an SSH tunnel
(`ssh -L 4179:127.0.0.1:4179 you@server`, then http://localhost:4179), or set `WEEVILS_HOST=0.0.0.0` in the env file
to open it to your LAN over plain http (the login cookie is only marked Secure behind HTTPS).

## Several machines

Install the main machine first, then on each other machine (it needs `ssh <main host>` to work without a password):

```sh
curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh | bash -s -- --secondary <main ssh host>
```

The secondary machine runs its own weevilsd (no app, no weevboss) and a reverse SSH tunnel to the main machine.
It registers itself there (`weevils-service add-remote <id>` adds it to `WEEVILS_REMOTES` and picks a free port from
4192), so its sessions show up in the main app.

## Testing the installer

```sh
test/docker/run.sh          # all scenarios, ends with PASS or FAIL
```

It installs the HEAD commit in blank `ubuntu:24.04` containers: a systemd "VPS" (install from a clone as a sudo
user, service + linger, login over http, idempotent re-run, `--domain` with Caddy, a `--secondary` machine federated
over SSH, reboot), and a plain container without systemd (piped install as root, background fallback).
