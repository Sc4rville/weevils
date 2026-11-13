# get — the public way in

`https://get.scarville.tech`: someone sees a link, opens it on a phone or a computer, and ends up on their own weevils
without typing anything (or, for a computer, by pasting one command in its terminal).

1. A short page (English by default, a small FR switch) says what weevils is, then right away: **plug in your
   machine** ("a server keeps your agents working while your phone and computer are off").
   - On a phone: a server first (created for you at Hostinger or Hetzner, or your own VPS), your computer second.
   - On a Linux or Windows (WSL) computer: connect this computer here and now (one command), with a nudge toward a
     VPS ("your agents keep working with this computer off"). On a Mac: a VPS (weevils runs on Linux for now).
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
   **I already have a VPS**: IP, user, password (or private key). One SSH connection starts the install in the
   background, then closes.
   **My computer**: `curl -fsSL https://get.scarville.tech/i/<id> | bash` in its terminal.
3. A live progress screen follows the install (the installer's step names).
4. At the end the page opens the person's own weevils (a phone switches to it by itself; a computer shows a QR code
   for the phone). The existing in-app onboarding takes over: weevboss welcomes them and connects Claude Code or
   Codex through their official sign-in link, then the first steps.

Where the new weevils is reached:

| path | address | HTTPS |
|---|---|---|
| Hetzner, own VPS | `https://<ip-with-dashes>.sslip.io` | Caddy + Let's Encrypt, set up by `install.sh --domain` |
| computer | `https://<random>.trycloudflare.com` | Cloudflare quick tunnel (no account); the address changes if the computer restarts. weevboss can set up a lasting one (Tailscale, a VPS) |

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
  encrypts the login link with the public half (`openssl pkeyutl`), and the service only relays the ciphertext. Only
  the page that started the setup can open it, and it only follows a link to the address the install reported.
- **The install reports step names only**, checked against the installer's own titles on both sides, never a line of
  its log (which holds the access code: it stays on the machine, `~/weevils-install.log`).
- **No code from visitors runs here.** The only program started is `ssh`, with a fixed command, toward a public
  address (private, loopback, link-local and this server's own addresses are refused).
- **Rate limits** per client address (setups, quotes, server creations, SSH attempts, script downloads) and per
  setup (reports), plus a cap on concurrent SSH connections and on setups in memory.
- **Preview gate**: with `GET_PREVIEW_KEY`, the page needs `/?k=<key>` (or `/#k=<key>`) in its URL, and its API calls
  carry the key in a header: no redirect and no cookie needed (some iOS contexts drop a cookie set on a redirect).
  Install scripts stay reachable by their unguessable setup id; the page's own assets are public.

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
| `GET_PREVIEW_KEY` | gate everything behind `/?k=<key>` until launch |
| `GET_REPO` | the repository installs clone (default GitHub) |
| `GET_BUNDLE` | while the repository is private: a bundle built by `get/make-bundle.sh` (one squashed commit, no history) |
| `GET_HETZNER_API`, `GET_HOSTINGER_API` | the hosts' API bases (tests: `get/host-mock.mjs`) |
| `GET_ALLOW_TARGETS`, `GET_TARGET_URLS` | tests only: a private SSH target allowed, and the URL its weevils gets (`ip=url`) |

On scarville.tech: systemd user unit `weevils-get`, env in `~/.config/weevils-get/env`, Caddy site
`/etc/caddy/sites/get.caddy` (explicit `127.0.0.1`, so the dev-server reaper leaves it alone).

## Tests

- `npx vitest run get/`: API, Hetzner and Hostinger doubles (sizes, prices, payment method, purchase body), the
  bootstrap's real `openssl` encryption opened like the page does, guards (preview gate, SSRF, step allowlist, rate
  limits).
- `node get/e2e.mjs ssh|pc|hetzner …`: drives a real setup through the API exactly like the page (key pair, polling,
  unsealing, then logs in to the new weevils with the unsealed code). Verified on 2026-11-13:
  - own VPS: the `essai` machine (`essai reset`), password over SSH;
  - computer: a plain Ubuntu 24.04 Docker container (no systemd), command pasted, Cloudflare link;
  - Hetzner and Hostinger: `get/host-mock.mjs`, whose "boot" resets `essai` and runs there, as root, what the host
    would (cloud-init's runcmd, or the post-install script);
  - the page in real iPhone WebKit (Playwright `webkit` in the `mcr.microsoft.com/playwright` image: Ubuntu 26.04
    has no WebKit build): gate by `?k=` and `#k=`, reload, language switch, size picker.
