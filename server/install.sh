#!/usr/bin/env bash
# Machine setup of weevils (called by ../install.sh, can also be run alone). Idempotent: re-run = update.
#   server/install.sh                        main machine: weevilsd serves the app and runs weevboss
#   server/install.sh secondary <ssh-host>   secondary machine: local weevilsd + reverse SSH tunnel to the main
#                                            machine <ssh-host>, which federates it (its sessions show up there)
#   server/install.sh pc                     legacy alias: secondary of the host "vps", ports 4191/4192, machine "pc"
# Ports come from ~/.config/weevils/env (WEEVILS_PORT, WEEVILS_HOOK_PORT); WEEVILS_TUNNEL_PORT forces the port the
# main machine listens on for this secondary one (otherwise the main machine picks a free one).
set -euo pipefail
USER=${USER:-$(id -un)}
role=${1:-main}
main_host=${2:-}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$here")
svc=$here/weevils-service
cfg() { "$svc" config "$@"; }

if [ "$role" = pc ]; then
  role=secondary main_host=${main_host:-vps}
  cfg default WEEVILS_MACHINE pc
  cfg default WEEVILS_PORT 4191
  WEEVILS_TUNNEL_PORT=${WEEVILS_TUNNEL_PORT:-4192}
  [ -n "$(cfg get WEEVILS_PROJECTS)" ] || cfg set WEEVILS_PROJECTS "$HOME/projects:$HOME/Documents/projects"
fi
case "$role" in
  main | vps) role=main ;;
  secondary) [ -n "$main_host" ] || { echo "usage: server/install.sh secondary <ssh host of the main machine>" >&2; exit 1; } ;;
  *) echo "usage: server/install.sh [main | secondary <ssh-host>]" >&2; exit 1 ;;
esac

port=$(cfg get WEEVILS_PORT); port=${port:-4179}
hook_port=$(cfg get WEEVILS_HOOK_PORT); hook_port=${hook_port:-4180}
# weevboss runs on the main machine only. A re-run keeps a main machine's choice (WEEVILS_ORCHESTRATOR=0 stays 0);
# a secondary machine becoming the main one gets it back.
prev_role=$(sed -n 's/^WEEVILS_ROLE=//p' ~/.config/weevils/service.conf 2>/dev/null | head -1 || true)
if [ "$role" = secondary ]; then cfg set WEEVILS_ORCHESTRATOR 0
elif [ "$prev_role" = secondary ]; then cfg set WEEVILS_ORCHESTRATOR 1
else cfg default WEEVILS_ORCHESTRATOR 1; fi

# ---------------------------------------------------------------- commands: wv, weevils (agents' cli), hook, service
mkdir -p ~/.local/bin ~/.claude
install -m 755 "$here/wv" ~/.local/bin/wv
install -m 755 "$here/weevils-service" ~/.local/bin/weevils-service
# The hook and the cli are called from agent sessions, whose environment may not carry the ports: bake them in.
sed "s/WEEVILS_HOOK_PORT:-4180/WEEVILS_HOOK_PORT:-$hook_port/" "$here/hook.sh" >~/.local/bin/weevils-hook && chmod 755 ~/.local/bin/weevils-hook
sed "s/WEEVILS_PORT:-4179/WEEVILS_PORT:-$port/" "$here/weevils-cli" >~/.local/bin/weevils && chmod 755 ~/.local/bin/weevils

# ---------------------------------------------------------------- Claude Code hooks: weevils-hook on the useful events, other hooks kept
settings=~/.claude/settings.json
[ -s "$settings" ] || echo '{}' >"$settings"
cp "$settings" "$settings.bak-weevils"
tmp=$(mktemp)
jq --arg cmd "$HOME/.local/bin/weevils-hook" '
  .hooks //= {} |
  reduce ("SessionStart","UserPromptSubmit","PostToolUse","Notification","Stop","SessionEnd") as $e (.;
    if ([.hooks[$e][]?.hooks[]?.command] | index($cmd)) then .
    else .hooks[$e] = ((.hooks[$e] // []) + [{"hooks":[{"type":"command","command":$cmd}]}]) end)
' "$settings" >"$tmp" && mv "$tmp" "$settings"

# Nothing interrupts a session: no auto-update, no tips (variables read by Claude Code).
tmp=$(mktemp)
jq '.env //= {} | .env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1" | .env.DISABLE_AUTOUPDATER = "1" | .env.DISABLE_TIPS = "1"' "$settings" >"$tmp" && mv "$tmp" "$settings"
# Hook scripts that no longer exist on disk are removed (they made every Stop fail).
for f in $(jq -r '.hooks[][]?.hooks[]?.command // empty' "$settings" | awk '{print $1}' | sort -u); do
  case "$f" in /*) [ -x "$f" ] || {
    tmp=$(mktemp)
    jq --arg f "$f" '.hooks |= with_entries(.value |= map(.hooks |= map(select((.command // "") | split(" ")[0] != $f)) | select(.hooks | length > 0)))' "$settings" >"$tmp" && mv "$tmp" "$settings"
    echo "hook removed (script missing): $f"
  } ;; esac
done
# Autocompact on: Claude Code no longer offers to enable it mid-work.
cfg_json=~/.claude.json
if [ -f "$cfg_json" ]; then tmp=$(mktemp); jq '.autoCompactEnabled = true' "$cfg_json" >"$tmp" && mv "$tmp" "$cfg_json"; fi

# ---------------------------------------------------------------- secondary machine: tunnel port, registered on the main machine
tunnel_port=${WEEVILS_TUNNEL_PORT:-}
if [ "$role" = secondary ]; then
  id=$(cfg get WEEVILS_MACHINE); id=${id:-$(hostname -s | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-\n' '-' | cut -c1-20)}
  ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
  if [ -z "$tunnel_port" ]; then
    # The main machine picks (or finds again) the port it will listen on for us, and adds us to WEEVILS_REMOTES.
    tunnel_port=$(ssh "${ssh_opts[@]}" "$main_host" "\$HOME/.local/bin/weevils-service add-remote $(printf '%q' "$id")" 2>/dev/null | tail -1 || true)
    if ! [[ "$tunnel_port" =~ ^[0-9]+$ ]]; then
      # shellcheck disable=SC1090
      tunnel_port=$( { [ -f ~/.config/weevils/service.conf ] && . ~/.config/weevils/service.conf; echo "${WEEVILS_TUNNEL_PORT:-4192}"; } )
      echo "WARNING: could not register this machine on $main_host (ssh $main_host without password? weevils installed there?)." >&2
      echo "  On $main_host, run: weevils-service add-remote $id http://127.0.0.1:$tunnel_port" >&2
    fi
  else
    ssh "${ssh_opts[@]}" "$main_host" "\$HOME/.local/bin/weevils-service add-remote $(printf '%q' "$id") http://127.0.0.1:$tunnel_port" >/dev/null 2>&1 ||
      echo "WARNING: on $main_host, run: weevils-service add-remote $id http://127.0.0.1:$tunnel_port" >&2
  fi
fi

# ---------------------------------------------------------------- service description (read by weevils-service)
node_bin=$(command -v node)
npm_bin=$(npm prefix -g 2>/dev/null)/bin
svc_path="$HOME/.local/bin:$(dirname "$node_bin"):$npm_bin:/usr/local/bin:/usr/bin:/bin"
mkdir -p ~/.config/weevils
cat >~/.config/weevils/service.conf <<EOF
# Written by server/install.sh — read by weevils-service.
WEEVILS_ROLE=$role
WEEVILS_DIR=$(printf '%q' "$repo")
WEEVILS_NODE=$(printf '%q' "$node_bin")
WEEVILS_PATH=$(printf '%q' "$svc_path")
WEEVILS_MAIN_HOST=$(printf '%q' "$main_host")
WEEVILS_TUNNEL_PORT=$tunnel_port
EOF

# ---------------------------------------------------------------- systemd --user (survives logout and reboot thanks to linger)
if [ -d /run/systemd/system ] && command -v loginctl >/dev/null; then
  if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]; then
    loginctl enable-linger "$USER" 2>/dev/null || { [ "$(id -u)" = 0 ] || sudo -n loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER"; } || true
  fi
  # The user manager starts with linger: wait for its bus (first run, or a session opened without login).
  for _ in $(seq 1 20); do [ -S "/run/user/$(id -u)/bus" ] && break; sleep 0.5; done
fi

units=~/.config/systemd/user
if [ "$("$svc" mode)" = systemd ]; then
  export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
  [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
  mkdir -p "$units"
  # A main unit from an older install carried WEEVILS_REMOTES: it moves to the config file.
  old=$(sed -n 's/^Environment=WEEVILS_REMOTES=//p' "$units/weevilsd.service" 2>/dev/null | head -1 || true)
  if [ -n "$old" ]; then cfg default WEEVILS_REMOTES "$old"; fi
  cat >"$units/weevilsd.service" <<EOF
[Unit]
Description=weevilsd — weevils server ($role): Claude Code / Codex sessions, app API
After=network.target

[Service]
WorkingDirectory=$repo
ExecStart=$node_bin server/index.ts
Restart=always
RestartSec=2
# The agent sessions (tmux server started by weevilsd) must survive a restart of weevilsd.
KillMode=process
Environment=PATH=$svc_path
Environment=NODE_ENV=production
# Settings and keys: one per line, NAME=value (model: weevils.env.example).
EnvironmentFile=-%h/.config/weevils/env

[Install]
WantedBy=default.target
EOF
  if [ "$role" = secondary ]; then
    cat >"$units/weevils-tunnel.service" <<EOF
[Unit]
Description=weevils — reverse SSH tunnel: $main_host reads this weevilsd (127.0.0.1:$tunnel_port there → 127.0.0.1:$port here)
After=network-online.target weevilsd.service

[Service]
ExecStart=$(command -v ssh) -NT -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 127.0.0.1:$tunnel_port:127.0.0.1:$port $main_host
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
  else
    systemctl --user disable --now weevils-tunnel >/dev/null 2>&1 || true
    rm -f "$units/weevils-tunnel.service"
  fi
  systemctl --user daemon-reload
fi
"$svc" restart
"$svc" status
