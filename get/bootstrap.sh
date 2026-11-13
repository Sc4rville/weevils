#!/usr/bin/env bash
# weevils — the install started from the setup page (get/server.mjs). One copy per setup; it holds no secret.
#
# What it does, on your machine:
#   1. As root (a fresh VPS): installs for a regular user with sudo (yours, or a new "weevils" user), never as root.
#   2. Gets weevils into ~/weevils and runs ./install.sh --agent (everything else is that installer's job).
#   3. A computer at home: opens an HTTPS link to it (Cloudflare quick tunnel), so your phone can reach it.
#   4. Tells the setup page how far it is: only the step names below, never a line of the installer's log (it holds
#      your access code). At the end, it sends your weevils' address encrypted with a key that only the page you
#      opened holds: the setup service never sees your access code.
# The installer's full log stays here, in ~/weevils-install.log.
set -euo pipefail

# The whole script is one function, called on the last line: a download cut short runs nothing.
_weevils_get() {
  BASE=@BASE@ SID=@SID@ UI_LANG=@LANG@ MODE=@MODE@ REACH=@REACH@ REPO=@REPO@ BUNDLE=@BUNDLE@
  PUB=@PUB@
  # The installer's step titles, the only lines that leave this machine.
  TITLES=@TITLES@

  say() { printf '  weevils · %s\n' "$*"; }
  report() { curl -fsS -m 20 -o /dev/null -X POST "$BASE/r/$SID" "$@" 2>/dev/null || true; }
  event() { report --data-urlencode "event=$1" ${2:+--data-urlencode "step=$2"}; }
  fail() {
    report --data-urlencode event=failed --data-urlencode "error=$(printf '%s' "$1" | tr '\n' ' ' | cut -c1-300)"
    printf '  weevils · %s\n' "$1" >&2
    exit 1
  }

  [ "$(uname -s)" = Linux ] || fail "weevils runs on Linux only for now (a VPS, a Linux PC, or WSL2)."

  # ------------------------------------------------------------ 1. root: hand over to a regular user
  if [ "$(id -u)" = 0 ]; then
    local user=${SUDO_USER:-}
    [ -n "$user" ] && [ "$user" != root ] || user=weevils
    event start
    if ! id -u "$user" >/dev/null 2>&1; then
      useradd -m -s /bin/bash "$user" || fail "could not create the user $user"
      say "user $user created"
    fi
    # A fresh VPS updates itself at boot: wait for apt's lock instead of failing on it.
    [ ! -d /etc/apt/apt.conf.d ] || printf 'DPkg::Lock::Timeout "600";\n' >/etc/apt/apt.conf.d/90weevils-lock
    if ! command -v sudo >/dev/null; then
      if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sudo >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sudo >/dev/null 2>&1; }
      elif command -v dnf >/dev/null; then dnf install -y -q sudo >/dev/null 2>&1
      fi
      command -v sudo >/dev/null || fail "sudo is missing and could not be installed"
    fi
    # weevils' agents install and configure things themselves: sudo without a password, like on a fresh VPS.
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$user" >"/etc/sudoers.d/90-weevils-$user"
    chmod 440 "/etc/sudoers.d/90-weevils-$user"
    loginctl enable-linger "$user" >/dev/null 2>&1 || true
    # Same script again, as that user (the URL stays valid for this setup).
    exec runuser -l "$user" -c "curl -fsSL '$BASE/i/$SID?as=user' | bash"
  fi

  event start
  cd "$HOME"
  # A computer: the person is at its terminal. If sudo wants a password, ask it once there (the installer itself never
  # prompts), and keep it fresh while the install runs.
  if [ "$MODE" = pc ] && ! sudo -n true 2>/dev/null && command -v sudo >/dev/null && { : </dev/tty; } 2>/dev/null; then
    say "weevils needs your password once, to install its tools:"
    sudo -v </dev/tty || true
    (while sudo -n -v 2>/dev/null; do sleep 50; done) &
    KEEP_SUDO=$!
    trap 'kill "$KEEP_SUDO" 2>/dev/null || true' EXIT
  fi
  # ------------------------------------------------------------ 2. the code
  if ! command -v git >/dev/null; then
    sudo -n true 2>/dev/null || fail "git is missing and installing it needs sudo without a password"
    if command -v apt-get >/dev/null; then sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null 2>&1 || { sudo -n apt-get update -qq >/dev/null 2>&1; sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null 2>&1; }
    elif command -v dnf >/dev/null; then sudo -n dnf install -y -q git >/dev/null 2>&1
    elif command -v pacman >/dev/null; then sudo -n pacman -S --noconfirm git >/dev/null 2>&1
    fi
    command -v git >/dev/null || fail "could not install git"
  fi
  local dir=$HOME/weevils
  if [ ! -d "$dir/.git" ]; then
    [ ! -e "$dir" ] || fail "$dir exists and is not a weevils clone"
    if [ "$BUNDLE" = 1 ]; then
      local b; b=$(mktemp)
      curl -fsSL "$BASE/weevils.bundle?sid=$SID" -o "$b" || fail "could not download weevils"
      git clone -q -b main "$b" "$dir" || fail "could not unpack weevils"
      rm -f "$b"
      git -C "$dir" remote set-url origin "$REPO"
    else
      git clone -q "$REPO" "$dir" || fail "could not download weevils from $REPO"
    fi
  fi

  # ------------------------------------------------------------ 3. the install, its step names reported
  local log=$HOME/weevils-install.log
  run_install() {
    : >"$log"
    (cd "$dir" && ./install.sh --agent --lang "$UI_LANG" "$@") >>"$log" 2>&1 &
    local pid=$! line t
    while IFS= read -r line; do
      [[ $line =~ ^\ ([^\ ].{0,70}[^\ ])\ $ ]] || continue
      t=${BASH_REMATCH[1]}
      case "$TITLES" in *"|$t|"*) report --data-urlencode event=step --data-urlencode "title=$t" ;; esac
    done < <(tail -n +1 -F --pid="$pid" "$log" 2>/dev/null)
    wait "$pid" || true
  }
  sum() { sed -n '/^--- weevils summary ---$/,/^--- end ---$/p' "$log" | sed -n "s/^$1=//p" | tail -1; }
  check() {
    local status; status=$(sum status)
    case $status in
      ok) ;;
      needs_sudo) fail "this needs admin rights: sudo without a password for $(id -un)" ;;
      '') fail "the installer stopped before its end (see ~/weevils-install.log)" ;;
      *) fail "$(sum error)" ;;
    esac
  }

  case $MODE in
    vps) run_install --domain "$REACH" ;;
    url) run_install --url "$REACH" ;;
    *) run_install ;;
  esac
  check

  # ------------------------------------------------------------ 4. a computer: an HTTPS link for the phone
  if [ "$MODE" = pc ] && [ "$(sum mode)" = local ]; then
    event step tunnel
    local port bin arch turl='' state=$HOME/.local/share/weevils
    port=$(sum port)
    mkdir -p "$HOME/.local/bin" "$state"
    bin=$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")
    if [ ! -x "$bin" ]; then
      case $(uname -m) in x86_64 | amd64) arch=amd64 ;; aarch64 | arm64) arch=arm64 ;; armv7l) arch=arm ;; *) fail "no secure link for this processor ($(uname -m))" ;; esac
      curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch" -o "$bin.tmp" || fail "could not download the secure link (cloudflared)"
      chmod 755 "$bin.tmp" && mv -f "$bin.tmp" "$bin"
    fi
    local tlog=$state/link.log
    : >"$tlog"
    if systemctl --user show-environment >/dev/null 2>&1; then
      mkdir -p "$HOME/.config/systemd/user"
      cat >"$HOME/.config/systemd/user/weevils-link.service" <<EOF
[Unit]
Description=weevils — HTTPS link for the phone (Cloudflare quick tunnel to 127.0.0.1:$port)
After=network-online.target weevilsd.service

[Service]
ExecStart=/bin/sh -c 'exec "$bin" tunnel --no-autoupdate --url http://127.0.0.1:$port >>"$tlog" 2>&1'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable weevils-link >/dev/null 2>&1 || true
      systemctl --user restart weevils-link
    else
      pkill -u "$(id -u)" -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$port" 2>/dev/null || true
      nohup "$bin" tunnel --no-autoupdate --url "http://127.0.0.1:$port" >>"$tlog" 2>&1 </dev/null &
    fi
    for _ in $(seq 1 60); do
      turl=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$tlog" | tail -1 || true)
      [ -z "$turl" ] || break
      sleep 1
    done
    [ -n "$turl" ] || fail "the secure link did not come up (see $tlog)"
    # Wait until the link answers, then tell weevils its public address.
    for _ in $(seq 1 30); do curl -fsS -m 5 -o /dev/null "$turl/manifest.webmanifest" 2>/dev/null && break; sleep 2; done
    run_install --url "$turl" --no-update
    check
  fi

  # ------------------------------------------------------------ 5. done: the address, sealed for the page
  local url link mode ready enc='' key
  url=$(sum url) link=$(sum link) mode=$(sum mode) ready=$(sum ready)
  if command -v openssl >/dev/null; then
    key=$(mktemp)
    printf '%s\n' "$PUB" | base64 -d >"$key" 2>/dev/null || true
    enc=$(printf '%s' "$link" | openssl pkeyutl -encrypt -pubin -keyform DER -inkey "$key" \
      -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 2>/dev/null | base64 | tr -d '\n' || true)
    rm -f "$key"
  fi
  report --data-urlencode event=done --data-urlencode "url=$url" --data-urlencode "mode=$mode" \
    --data-urlencode "ready=$ready" --data-urlencode "sealed=$enc"
  echo
  say "ready: $url"
  [ -n "$enc" ] || say "open the link from $log on your phone (the setup page could not receive it)"
  if [ "$MODE" = pc ]; then
    say "on your phone, open this link (it logs you in, keep it to yourself):"
    printf '\n  %s\n\n' "$link"
    ! command -v qrencode >/dev/null || qrencode -t ANSIUTF8 -m 2 "$link" | sed 's/^/  /'
  fi
}
_weevils_get
