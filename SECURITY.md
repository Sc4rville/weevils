# Security

weevils lets you watch and drive the Claude Code and Codex sessions of one machine from your phone. That machine's
agents run as you, with your files. This page says what the install does and doesn't do, what leaves your machine,
and how to turn each part off or remove it. It is served at https://get.scarville.tech/security.

## The recommended setup: a server of its own

The setup page (https://tryweevils.scarville.tech) recommends a small rented server, which it can create for you at
Hetzner. Agents then work on a machine that holds nothing else of yours. Your Hetzner API token stays in your
browser: the page calls Hetzner's API directly (`api.hetzner.cloud`), and the token never reaches the setup service.
After the server exists, you can delete the token in Hetzner's console. The page only works when it is open.

Agents work on their own by default, on a server as on a computer: they run commands without waiting for you. In the
app, Your factory > Intelligence > Agents > « Ask me » makes every machine's agents ask first (Claude Code's and
Codex's permission prompts, answered from the app); a session can have its own choice, from its page. As root, Claude
Code always asks. weevils never accepts Claude Code's safety checks for you, and it answers "do you trust this
folder?" only for folders inside your project roots.

On your own computer, weevils works the same way, but its agents can reach everything your user can. There:

- **the computer answers from the Internet.** It gets a stable address, `https://<name>.tryweevils.scarville.tech`,
  the same after every restart or network change, so the installed app and a chat app's connector (`…/mcp`) keep
  working. weevils keeps one outgoing HTTPS connection to the weevils relay (`server/link-relay.ts`, run by
  Scarville on that domain), which passes the requests for that name, and only those, down it to weevils' port on
  `127.0.0.1`: no port opens on the computer or the router. The relay keeps a SHA-256 hash of the name's token,
  never the token; it logs when a name connects or leaves, never an IP address, a request or its content. Like any
  HTTPS proxy (Cloudflare's tunnel included) it decrypts the traffic it passes on. Each name gets its own
  certificate, so it appears in public certificate logs: expect the login page to be found. Only weevils' app is
  behind it, and only with your access code (72 random bits; a wrong code waits 800 ms); a browser that logged in
  keeps a device cookie for a year (log out, or the "lost a phone" steps in the README, to revoke it). Requests
  through the relay are never taken for the machine itself (they carry `X-Forwarded-For`). `weevils address
  release` gives the name back (it stops answering at once). The setup page and the script say so before the
  install. `--no-link` installs without it: weevils stays on this machine until you set up a private way in
  (Tailscale, a private network between your own devices). If the relay cannot be reached at install time, a
  Cloudflare quick tunnel (`cloudflared`, from Cloudflare's GitHub release, checked against the SHA-256 GitHub
  publishes for it) stands in, with a new `https://….trycloudflare.com` address at each start; weevils moves to a
  stable address by itself as soon as it can, and stops that tunnel. Anyone can run their own relay
  (`WEEVILS_LINK_RELAY`, docs/stable-address.md).
- programs on the computer don't get in without the code either, unless they can read weevils' local token
  (`~/.local/share/weevils/local-token`, readable by your user only), which weevils' own commands send.

## Other ways in

Besides the app and your access code, two optional ways in, both closed until you open them. The connector for
ChatGPT or Claude.ai (`/mcp`): you sign it in with your access code, and its tokens reach only the weevbook, never
`/api`. Agent keys (`/agent/v1`, [docs/agents.md](docs/agents.md)): made in the app's settings, each one can only
send messages to weevboss, signed with its own name (never yours), and read the replies to them; weevils keeps only
their SHA-256, and a revoked key stops working at once. The e-mail bridge is deprecated and off unless
`WEEVILS_MAIL_BRIDGE=on`.

## What the install does

The command from the setup page is `curl -fsSL https://get.scarville.tech/install.sh | bash -s <setup id>`. Every
visitor gets the same script, with its SHA-256 at `/install.sh.sha256`. It begins with a plain list of what it does.
In short, as you and in your home folder:

1. It downloads the weevils code (`/weevils.bundle`, a git bundle) and **checks its signature** against the release
   key pinned in the script (`ssh-keygen -Y verify`, namespace `weevils-release`). Where OpenSSH is older than 8.1,
   it checks the published SHA-256 instead. A bundle that doesn't check is refused, and nothing gets installed.
2. It runs `~/weevils/install.sh --agent`. That adds whatever is missing:
   - Node.js 22: the official build, checked against nodejs.org's `SHASUMS256.txt`, in
     `~/.local/share/weevils/node`.
   - Claude Code, through Anthropic's own installer.
   - the `weevilsd` service, listening on `127.0.0.1` only.
   - a few commands in `~/.local/bin`, weevils' hooks in `~/.claude/settings.json`, and an update timer. The
     settings file keeps its mode, and stays a symlink if it is one. A `~/.local/bin/tmux` of your own is kept as
     `tmux.bak-weevils` (weevils' tmux guard runs it) and comes back at uninstall. The hook never holds a session up:
     one second at most, and nothing to wait for after a tool call.
3. **No root for missing system tools** (git, curl, tmux, jq, python3) on Debian and Ubuntu: apt downloads your
   distribution's own signed packages as you (`apt-get download`), and they are unpacked in
   `~/.local/share/weevils/sys`, never installed system-wide. On other distributions, or if that fails, the script
   prints the exact command (for example `sudo dnf install -y tmux jq`), asks your password for that command only,
   then drops it (`sudo -k`). If nothing is missing, no password is asked. On a Mac, root is needed only for
   Homebrew's own installer, when Homebrew is missing.
4. When run as root (that is how a fresh server starts it), it creates a regular user with passwordless sudo and
   installs as that user, so agents there can install and configure things (asking you first, unless you turned the
   prompts off). On such a server, the HTTPS site (Caddy) opens ports 80 and 443 in ufw when ufw is active.

The install never sends your files, code, conversations, keys or passwords anywhere. It never opens a port on your
router, and on a computer never touches its firewall. Apart from this script itself (read it first; SHA-256 at
`/install.sh.sha256`), it never runs anything from the setup service that the release key didn't sign.

## What leaves your machine

- **During the install**, to the setup service: the installer's step names (from a fixed list), your weevils'
  address, its version, and the login link sealed with a key that only your open setup page holds (RSA-OAEP). The
  setup service can't read your access code. At the start, so it can tell a server from a computer by itself: the
  system's name (`uname -s`), whether systemd runs it, and whether the address the setup service sees it from is on
  one of the machine's own interfaces. No machine name, user name or other address.
- **At your first login**, once: a "claimed" signal, so the setup service stops keeping your sealed link.
- **Updates**: every 20 to 30 minutes, weevils asks the setup service for its current version. When there is a newer
  one, it downloads the bundle and checks its signature with the release key of the version you already run. It
  installs the bundle only if the signature checks. A clone of the GitHub repository instead reads the setup
  service's release manifest (`/main.txt`, `/main.txt.sig`: the main commit it published after its checks, signed
  with the same key), checks the signature the same way, and fast-forwards to that exact commit from GitHub, only
  when it descends from the one installed. Turn updates off with `--no-auto-update` at install time, in the
  app's settings, or with `weevils config set WEEVILS_AUTO_UPDATE 0`. They then stop entirely.
- **The computer's phone link**, when there is one: the app's traffic between your phone (or a chat app) and the
  computer goes through the weevils relay (or, as a fallback, Cloudflare's quick tunnel), which carries the HTTPS
  connection.
- **The setup page** counts visits anonymously: counters only, no cookie, no IP address kept, deleted after 90 days.

Nothing else. Your agents talk to Anthropic and OpenAI the way Claude Code and Codex always do.

## Releases and the signing key

Each code snapshot served to installs and updates is signed with weevils' release key:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFpRTm2M0I5A8YHEqefdBacmjGeN63IR89ejA549gLz/ weevils-release
SHA256:2rMC745nllRyT+6YeUVOV25xgD5yGe8nxNNOM5ThEnw
```

It is also in `get/release-key.pub` and at https://get.scarville.tech/release-key.pub. To check a bundle by hand:

```sh
curl -fsSLO https://get.scarville.tech/weevils.bundle && curl -fsSLO https://get.scarville.tech/weevils.bundle.sig
printf 'weevils-release %s\n' "$(curl -fsSL https://get.scarville.tech/release-key.pub)" > allowed
ssh-keygen -Y verify -f allowed -I weevils-release -n weevils-release -s weevils.bundle.sig < weevils.bundle
```

The key signs on the machine that serves the setup page, so it protects the code between that machine and yours. It
does not protect against that machine itself being taken over; there the key belongs to a dedicated user that only
signs, so the sessions and automations running on that machine cannot read it. A bundle, and the release manifest
of the same main commit, is published only after the tests pass on it; an install refuses a bundle that is unsigned
or older than the one it runs, and a clone refuses a manifest that is unsigned or names a commit that does not
descend from its own. The first install from a clone is the code you cloned: read it, or check that its commit is
the one in `/main.txt` (signed as above). The code is public at https://github.com/Sc4rville/weevils, and each
bundle is one commit « weevils <rev> »: the files of that public commit, minus the paths listed in
`scripts/release-policy.json`, so what you install is what you can read.

## Remove it

```sh
~/weevils/install.sh --uninstall --purge && rm -rf ~/weevils
```

That stops and removes the service, the phone link (weevils' own tunnel only: other Cloudflare tunnels of yours
stay up), the update timer, the commands, and the hooks in `~/.claude/settings.json` (with
`skipDangerousModePermissionPrompt` when weevils wrote it). Node.js links in `~/.local/bin` go too, and so do the
install log (`~/weevils-install.log`), weevils' cache (`~/.cache/weevils`) and Claude Code's trust for weevils' own
folders in `~/.claude.json`. `--purge` also removes weevils' settings and data, Node.js's files in
`~/.local/share/weevils/node` included, the copy of your Claude Code settings from before weevils
(`settings.json.bak-weevils`), and Claude Code's records of weevils' own folders (weevboss's conversations). Claude
Code stays, since you may use it without weevils. The install log never holds your access code: the login link is
in `~/.local/share/weevils/login-link`, readable by you only.

## Reporting a problem

Please report vulnerabilities privately, not in a public issue: GitHub's private vulnerability reporting on
https://github.com/Sc4rville/weevils, or a direct message to @weevilscode on X.
