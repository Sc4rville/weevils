# get — the public way in

`https://tryweevils.scarville.tech` (the link to share; `https://get.scarville.tech` serves the same): someone sees a
link, opens it on a phone or a computer, and ends up on their own weevils without typing anything (or, for a computer,
by pasting one command in its terminal). Open to anyone since 2026-11-14, with one link for everyone. Pasted on
Twitter/X, iMessage or WhatsApp, it shows a share card (Open Graph and Twitter tags in `index.html`; the image,
`og.png`, 1200×630, is `og-card.html` rendered by a headless browser).

1. A short page (English by default, a small FR switch) says what weevils is, then right away: **plug in your
   machine** ("a server keeps your agents working while your phone and computer are off").
   - On a phone: a server first (created for you at Hostinger or Hetzner, or your own VPS), your computer second.
   - On a Mac, Linux or Windows (WSL) computer: connect this computer here and now (one command), with a nudge
     toward a VPS ("your agents keep working with this computer off").
2. **Create a server for me** at **Hostinger** (the simplest, recommended) or **Hetzner** (the cheapest): the person
   creates an account and an API token (links on the page), pastes the token in a masked field, then picks one of
   three sizes with the real prices from the host's API: light (4 GB, 2 to 3 agents), recommended (8 GB, about 6),
   strong (16 GB, about a dozen; a Claude Code session takes up to about 1 GB). Neither host offers OAuth to third
   parties: a token is the only way.
   - Hostinger ([API reference](https://developers.hostinger.com), OpenAPI 3.0.0): the KVM 1/2/4 plans billed
     monthly (no 12- or 24-month commitment; first-month and renewal prices shown), paid with the card saved in
     hPanel (`GET /api/billing/v1/payment-methods`; none → a clear message before anything is bought), Ubuntu 24.04,
     a data center near the person, and a post-install script (`POST /api/vps/v1/post-install-scripts`, run as root
     after the OS is in) that starts the install. Purchase: `POST /api/vps/v1/virtual-machines`. A `202` (payment
     still processing) means the VM isn't set up: the page sends the person to hPanel, then to "I already have a VPS".
     The script stays in their account (`weevils-<id>`); its link expires with the setup.
   - Hetzner: the cheapest x86 type of each size near the person, Ubuntu 24.04, a cloud-init that runs the install.
     Hetzner bills by the hour: each size shows its real hourly price and its monthly cap ("€0.0115/h · max
     €7.19/month"), VAT included, with the server's IPv4 address that Hetzner bills on top of the type (`GET /pricing`),
     and the button says "billed by the hour". Sign-up asks for an ID check (a photo of an ID and a selfie, through iDenfy), then a manual review: the page says
     so under the option and on the account step, so nobody is surprised.
   **I already have a VPS**: IP, user, password (or private key). One SSH connection starts the install in the
   background, then closes.
   **My computer** (Mac, Linux, or Windows with WSL): `curl -fsSL https://get.scarville.tech/i/<id> | bash` in its
   terminal.
3. A live progress screen follows the install (the installer's step names).
4. At the end the page opens the person's own weevils (a phone switches to it by itself; a computer shows a QR code
   for the phone). The existing in-app onboarding takes over: weevboss welcomes them and connects Claude Code or
   Codex through their official sign-in link, then the first steps.

Where the new weevils is reached:

| path | address | HTTPS |
|---|---|---|
| Hetzner, own VPS | `https://<ip-with-dashes>.sslip.io` | Caddy + Let's Encrypt, set up by `install.sh --domain` |
| computer | `https://<random>.trycloudflare.com` | Cloudflare quick tunnel (no account); the address changes if the computer restarts. weevboss can set up a lasting one (Tailscale, a VPS) |

### On a Mac

Same command, same screens. `get/bootstrap.sh` is written for macOS's own bash (3.2) and BSD tools, and differs from
Linux in four places:

- **As yourself, never root.** `sudo curl … | bash` stops with a sentence saying so (Homebrew refuses root, and the
  root path creates a Linux user).
- **Homebrew first.** Everything weevils needs on a Mac comes from Homebrew, installed as the person. When it is
  missing, the script asks for the Mac password once in the terminal (`sudo -v`, kept fresh while it runs) and runs
  Homebrew's official installer without questions, before anything else: that installer also brings Apple's Command
  Line Tools, which git needs to get the code (without them `/usr/bin/git` only opens a dialog). With Homebrew already
  there, no password is asked at all. No way to type one (no terminal) and no Homebrew: it stops and says so.
- **The link is a launchd agent**, `~/Library/LaunchAgents/com.github.sc4rville.weevils-link.plist`, loaded in the
  session opened on the Mac's screen (`gui/<uid>`), started at login and restarted if it stops, where Linux has the
  systemd user unit `weevils-link`. cloudflared comes from Homebrew (else from its release archive). Its log is the
  same file, `~/.local/share/weevils/link.log`. Reached over SSH with no session on the screen: a plain background
  process and no agent file, like on a Linux without systemd. `install.sh --uninstall` removes the agent.
- **The link is sealed with Node first** (`crypto.publicEncrypt`, RSA-OAEP, SHA-256), then `openssl` if that fails:
  the openssl macOS ships is LibreSSL, which may not know the OAEP options. Linux tries them the other way round.

## Security

- **Nothing stored.** Setups live in memory for at most 3 hours; no database, no file. Request bodies are never
  logged (Caddy logs the paths only).
- **Secrets are used once.** The Hetzner token makes the quote and the create calls, then is dropped (the page clears
  it too). The SSH password goes to `ssh` through an askpass environment variable (never argv, never disk) for one
  command; a private key goes to a file in RAM (`/dev/shm`) for the few seconds of that connection. The root password
  Hetzner returns is discarded.
- **No access afterwards.** The service keeps no SSH key, no token and no tunnel. The new weevils is served by the
  person's machine itself; nothing is proxied through this service.
- **The access code never reaches the service.** The page generates an RSA-OAEP key pair (WebCrypto); the install
  encrypts the login link with the public half (`openssl pkeyutl`, or Node's `crypto`), and the service only relays the ciphertext. Only
  the page that started the setup can open it, and it only follows a link to the address the install reported.
- **The install reports step names only**, checked against the installer's own titles on both sides, never a line of
  its log (which holds the access code: it stays on the machine, `~/weevils-install.log`). Two steps are the
  bootstrap's own and go by name: `tunnel`, and `s_system` while it installs Homebrew on a Mac.
- **No code from visitors runs here.** The only program started is `ssh`, with a fixed command, toward a public
  address (private, loopback, link-local and this server's own addresses are refused).
- **Rate limits** per client address (setups, quotes, server creations, SSH attempts, script downloads) and per
  setup (reports), plus a cap on concurrent SSH connections and on setups in memory.
- **Preview gate** (off since the launch; old links with `?k=` still open the page, the key is ignored): with
  `GET_PREVIEW_KEY`, the page needs `/?k=<key>` (or `/#k=<key>`) in its URL, and its API calls carry the key in a
  header: no redirect and no cookie needed (some iOS contexts drop a cookie set on a redirect). Install scripts stay
  reachable by their unguessable setup id; the page's own assets are public.

What the service *does* have, briefly, by design: during "I already have a VPS", the password, for one connection;
during "Create a server for me", the token, for two API calls. A modified service could keep them; the code is open
so anyone can check what runs, and both can be revoked right after (delete the token at Hetzner, change the password).

## Run

```sh
GET_PORT=4182 GET_BASE=https://get.scarville.tech node get/server.mjs
```

| env | meaning |
|---|---|
| `GET_BASE` | public URL of this service (used in the install command and cloud-init) |
| `GET_PREVIEW_KEY` | gate everything behind `/?k=<key>` (unset on scarville.tech since the launch) |
| `GET_REPO` | the repository installs clone (default GitHub) |
| `GET_BUNDLE` | while the repository is private: a bundle built by `get/make-bundle.sh [<rev>] [<out>] [<checkout>]` (one squashed commit, no history), kept on `origin/main` by `get/refresh-bundle.sh` (the `weevils-get-bundle` timer, every 2 min). It is what every install gets, so it must hold the installer that supports macOS; the file is read at each download, replacing it needs no restart |
| `GET_INSTALLER` | the `install.sh` the allowed step titles are read from, at start (default: this clone's). Same titles as the bundle's |
| `GET_HETZNER_API`, `GET_HOSTINGER_API` | the hosts' API bases (tests: `get/host-mock.mjs`) |
| `GET_ALLOW_TARGETS`, `GET_TARGET_URLS` | tests only: a private SSH target allowed, and the URL its weevils gets (`ip=url`) |

On scarville.tech: systemd user unit `weevils-get`, env in `~/.config/weevils-get/env`, Caddy site
`/etc/caddy/sites/get.caddy` for both `get.scarville.tech` and `tryweevils.scarville.tech` (explicit `127.0.0.1`, so
the dev-server reaper leaves it alone).

## Tests

- `npx vitest run get/`: API, Hetzner and Hostinger doubles (sizes, prices, payment method, purchase body), the
  bootstrap's real `openssl` encryption opened like the page does, guards (preview gate, SSRF, step allowlist, rate
  limits). For a Mac: the script read by bash 3.2 (the `bash:3.2` Docker image when it is there), the page's first
  screen for a Mac, Linux and iPhone browser (happy-dom), the bootstrap's two ways of sealing the link (its own shell
  functions, Node and openssl) opened with WebCrypto like the page.
- `get/test-macos.sh`: the Mac branches of the bootstrap on Linux. The served script runs under bash 3.2 (Docker) on
  a fake Mac: stand-ins for `uname`, `sudo`, `xcode-select`, `git`, Homebrew's installer, `brew`, `launchctl`,
  `cloudflared` and `install.sh`, and guards that stop the run on a GNU-only flag or a tool macOS lacks. Four
  scenarios against a real `get/server.mjs`: a new Mac in a terminal (password once, Homebrew before git, launchd
  agent, link sealed and opened), root, no terminal for the password, a Mac over SSH where nothing can seal the link.
  It proves the order and the shell, not Homebrew, launchd, sudo or the BSD tools themselves.
- `node get/e2e-mac.mjs` (`WVGET_SOURCE=<checkout>` or `WVGET_BUNDLE=<file>`): the same path for real, on a Mac, with
  no browser: a local service, a setup created like the page does, the command run with `/bin/bash`, the real
  installer, a real quick tunnel, then the sealed link opened and the new weevils logged in to. For a macOS runner
  of GitHub Actions; `--dry` stops before the command.
- `node get/e2e.mjs ssh|pc|hetzner …`: drives a real setup through the API exactly like the page (key pair, polling,
  unsealing, then logs in to the new weevils with the unsealed code). Verified on 2026-11-13:
  - own VPS: the `essai` machine (`essai reset`), password over SSH;
  - computer: a plain Ubuntu 24.04 Docker container (no systemd), command pasted, Cloudflare link;
  - Hetzner and Hostinger: `get/host-mock.mjs`, whose "boot" resets `essai` and runs there, as root, what the host
    would (cloud-init's runcmd, or the post-install script);
  - the page in real iPhone WebKit (Playwright `webkit` in the `mcr.microsoft.com/playwright` image: Ubuntu 26.04
    has no WebKit build): gate by `?k=` and `#k=`, reload, language switch, size picker.
