#!/usr/bin/env bash
# Installe weevils sur la machine : lanceur wv, hook Claude Code, service weevilsd. Idempotent.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p ~/.local/bin ~/.config/systemd/user
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

cp "$here/weevilsd.service" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now weevilsd >/dev/null
systemctl --user restart weevilsd
echo "weevils installé : wv, hook Claude Code, service weevilsd ($(systemctl --user is-active weevilsd))"
