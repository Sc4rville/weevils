#!/usr/bin/env bash
# Installe weevils sur une machine. Idempotent.
#   server/install.sh        sur le VPS : weevilsd (API + app), qui fédère le PC via le tunnel
#   server/install.sh pc     sur le PC  : weevilsd local (sessions du PC) + tunnel SSH inversé vers le VPS
set -euo pipefail
role=${1:-vps}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$here")
units=~/.config/systemd/user
mkdir -p ~/.local/bin "$units"
install -m 755 "$here/wv" ~/.local/bin/wv
install -m 755 "$here/hook.sh" ~/.local/bin/weevils-hook

# Hooks Claude Code : on ajoute weevils-hook aux événements utiles, sans toucher aux hooks existants.
settings=~/.claude/settings.json
[ -f "$settings" ] || echo '{}' > "$settings"
cp "$settings" "$settings.bak-weevils"
tmp=$(mktemp)
jq --arg cmd "$HOME/.local/bin/weevils-hook" '
  .hooks //= {} |
  reduce ("SessionStart","UserPromptSubmit","PostToolUse","Notification","Stop","SessionEnd") as $e (.;
    if ([.hooks[$e][]?.hooks[]?.command] | index($cmd)) then .
    else .hooks[$e] = ((.hooks[$e] // []) + [{"hooks":[{"type":"command","command":$cmd}]}]) end)
' "$settings" > "$tmp" && mv "$tmp" "$settings"

if [ "$role" = pc ]; then
  cat > "$units/weevilsd.service" <<EOF
[Unit]
Description=weevilsd (PC) — sessions Claude/Codex du PC, lues par le weevilsd du VPS
After=network.target

[Service]
WorkingDirectory=$repo
ExecStart=$(command -v node) server/index.ts
Restart=always
RestartSec=3
KillMode=process
Nice=10
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=WEEVILS_MACHINE=pc
Environment=WEEVILS_MACHINE_NAME=pc
Environment="WEEVILS_MACHINE_NOTE=PC de Scarville · visible quand il est allumé"
Environment=WEEVILS_PORT=4191
Environment=WEEVILS_PROJECTS=%h/projects:%h/Documents/projects

[Install]
WantedBy=default.target
EOF
  cat > "$units/weevils-tunnel.service" <<'EOF'
[Unit]
Description=weevils — tunnel SSH inversé : le VPS lit le weevilsd du PC (127.0.0.1:4192 → PC:4191)
After=network-online.target weevilsd.service

[Service]
ExecStart=/usr/bin/ssh -NT -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 127.0.0.1:4192:127.0.0.1:4191 vps
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now weevilsd weevils-tunnel >/dev/null 2>&1
  systemctl --user restart weevilsd weevils-tunnel
  echo "weevils (PC) installé : weevilsd $(systemctl --user is-active weevilsd), tunnel $(systemctl --user is-active weevils-tunnel)"
else
  cat > "$units/weevilsd.service" <<EOF
[Unit]
Description=weevilsd — serveur weevils (sessions Claude/Codex, API de l'app)
After=network.target

[Service]
WorkingDirectory=$repo
ExecStart=$(command -v node) server/index.ts
Restart=always
RestartSec=2
# Les sessions d'agents (serveur tmux lancé par weevilsd) doivent survivre à un redémarrage de weevilsd.
KillMode=process
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=WEEVILS_REMOTES=pc=http://127.0.0.1:4192

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now weevilsd >/dev/null 2>&1
  systemctl --user restart weevilsd
  echo "weevils installé : wv, hook Claude Code, weevilsd $(systemctl --user is-active weevilsd)"
fi
