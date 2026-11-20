#!/usr/bin/env bash
# weevils — plug this computer into your weevils, as a second machine its agents can run on.
#
# What it does: makes an SSH key for weevils on this computer (~/.ssh/weevils_ed25519), sends its public half and this
#   computer's name to your weevils with the one-time code, writes where to reach it in ~/.ssh/config and
#   ~/.ssh/known_hosts, then installs weevils here as a second machine (install.sh --secondary), which keeps a tunnel
#   open to your weevils.
# What your weevils lets that key do: hold that one tunnel and register this computer. No shell, no other command.
# Usage: curl -fsSL <your weevils>/api/join.sh | bash -s <code>
set -euo pipefail

# Everything in a function: bash reads this script from a pipe, and nothing below may eat the rest of it.
main() {
  local base="__BASE__" code="${1:-}" fr=0
  case "${LC_ALL:-${LANG:-}}" in fr*) fr=1 ;; esac
  say() { if [ "$fr" = 1 ]; then printf '%s\n' "$1" >&2; else printf '%s\n' "$2" >&2; fi; }
  case "$code" in
    '' | *[!A-Za-z0-9_-]*) say "Il faut la ligne entière donnée par weevboss (elle finit par un code)." "This needs the whole line from weevboss (it ends with a code)."; exit 1 ;; # i18n-ignore
  esac
  local c
  for c in curl ssh ssh-keygen; do
    command -v "$c" >/dev/null 2>&1 || { say "$c manque sur cet ordinateur : installe-le, puis recolle la ligne." "$c is missing on this computer: install it, then paste the line again."; exit 1; } # i18n-ignore
  done

  local key=$HOME/.ssh/weevils_ed25519 name reply
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  [ -f "$key" ] || ssh-keygen -q -t ed25519 -N '' -C "weevils@$(hostname 2>/dev/null || echo computer)" -f "$key" </dev/null
  name=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo computer)
  reply=$(curl -fsS --data-urlencode "id=$name" --data-urlencode "key=$(cat "$key.pub")" "$base/api/join/$code" </dev/null) || {
    say "Ce code a expiré ou a déjà servi : demande une nouvelle ligne à weevboss." "This code has expired or was already used: ask weevboss for a new line." # i18n-ignore
    exit 1
  }
  field() { sed -n "s/^$1=//p" <<<"$reply" | head -1; }
  local id port target alias lang user host
  id=$(field id); port=$(field port); target=$(field target); alias=$(field alias); lang=$(field lang)
  [[ "$id" =~ ^[a-z0-9][a-z0-9-]{0,19}$ && "$port" =~ ^[0-9]{2,5}$ && "$target" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.:-]+$ && "$alias" =~ ^weevils-[a-z0-9-]+$ ]] || {
    say "Réponse inattendue de weevils." "Unexpected answer from weevils."; exit 1 # i18n-ignore
  }
  [[ "$lang" =~ ^(en|fr)$ ]] || lang=en
  user=${target%@*}; host=${target#*@}

  # Where the main machine is: an alias of its own, this key only, its host keys as weevils gave them.
  touch "$HOME/.ssh/config" "$HOME/.ssh/known_hosts" && chmod 600 "$HOME/.ssh/config"
  if ! grep -qx "Host $alias" "$HOME/.ssh/config"; then
    printf '\n# weevils (join.sh): the main machine\nHost %s\n  HostName %s\n  User %s\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' \
      "$alias" "$host" "$user" "$key" >>"$HOME/.ssh/config"
  fi
  sed -n 's/^known=//p' <<<"$reply" | while IFS= read -r k; do
    grep -qxF "$k" "$HOME/.ssh/known_hosts" || printf '%s\n' "$k" >>"$HOME/.ssh/known_hosts"
  done

  say "Clé acceptée. J’installe weevils ici comme machine « $id », quelques minutes…" "Key accepted. Installing weevils here as machine \"$id\", a few minutes…" # i18n-ignore
  # The installer itself, piped as everywhere else (WEEVILS_INSTALL_SH: a local copy, for tests).
  {
    if [ -n "${WEEVILS_INSTALL_SH:-}" ]; then cat "$WEEVILS_INSTALL_SH"
    else curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh; fi
  } | WEEVILS_TUNNEL_PORT=$port bash -s -- --yes --lang "$lang" --secondary "$alias" --machine "$id"
}
main "$@"
