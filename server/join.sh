#!/usr/bin/env bash
# weevils — plug this computer into your weevils, as a second machine its agents can run on.
#
# What it does: makes an SSH key for weevils on this computer (~/.ssh/weevils_ed25519), sends its public half and this
#   computer's name to your weevils with the one-time code, writes where to reach it in ~/.ssh/config and
#   ~/.ssh/known_hosts, then installs weevils here as a second machine (install.sh --secondary), which keeps a tunnel
#   open to your weevils.
# What your weevils lets that key do: hold that one tunnel and register this computer. No shell, no other command.
# Your conversations: when your weevils keeps them on your GitHub (its vault), this computer's go there too. The script
#   makes a second key for that only (~/.config/weevils/vault-deploy), your weevils adds it to the vault's repository
#   and answers with the vault's address and key (~/.config/weevils/vault.json and vault.key, readable by you alone).
# Usage: curl -fsSL <your weevils>/api/join.sh | bash -s <code> [--since <YYYY-MM-DD> | --match '<words>']
#   Every conversation already on this computer is brought in; --since keeps those active since that day, --match
#   those whose title or first request holds the words (weevboss adds them to the line when you ask).
set -euo pipefail

# Everything in a function: bash reads this script from a pipe, and nothing below may eat the rest of it.
main() {
  local base="__BASE__" code="${1:-}" fr=0 since='' match=''
  case "${LC_ALL:-${LANG:-}}" in fr*) fr=1 ;; esac
  say() { if [ "$fr" = 1 ]; then printf '%s\n' "$1" >&2; else printf '%s\n' "$2" >&2; fi; }
  case "$code" in
    '' | *[!A-Za-z0-9_-]*) say "Il faut la ligne entière donnée par weevboss (elle finit par un code)." "This needs the whole line from weevboss (it ends with a code)."; exit 1 ;; # i18n-ignore
  esac
  shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --since) since=${2:-}; shift || true ;;
      --match) match=${2:-}; shift || true ;;
    esac
    shift || true
  done
  # A day, or a few plain words: they are written as they are in a small file the import reads.
  if [ -n "$since" ] && ! [[ "$since" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    say "La date s’écrit AAAA-MM-JJ, par exemple 2026-10-01." "The date is written YYYY-MM-DD, for example 2026-10-01."; exit 1 # i18n-ignore
  fi
  case "$match" in
    *[[:cntrl:]]* | *\"* | *\\*) say "Les mots à chercher ne peuvent pas contenir de guillemets." "The words to look for cannot hold quotes."; exit 1 ;; # i18n-ignore
  esac
  local c
  for c in curl ssh ssh-keygen; do
    command -v "$c" >/dev/null 2>&1 || { say "$c manque sur cet ordinateur : installe-le, puis recolle la ligne." "$c is missing on this computer: install it, then paste the line again."; exit 1; } # i18n-ignore
  done

  local key=$HOME/.ssh/weevils_ed25519 conf=$HOME/.config/weevils name reply
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  [ -f "$key" ] || ssh-keygen -q -t ed25519 -N '' -C "weevils@$(hostname 2>/dev/null || echo computer)" -f "$key" </dev/null
  # A key for the vault alone: it can push to the vault's repository on your GitHub, and nothing else anywhere.
  [ -d "$conf" ] || { mkdir -p "$conf" && chmod 700 "$conf"; }
  [ -f "$conf/vault-deploy" ] || ssh-keygen -q -t ed25519 -N '' -C weevils-vault -f "$conf/vault-deploy" </dev/null
  name=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo computer)
  reply=$(curl -fsS --data-urlencode "id=$name" --data-urlencode "key=$(cat "$key.pub")" --data-urlencode "vault=$(cat "$conf/vault-deploy.pub")" "$base/api/join/$code" </dev/null) || {
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

  # The vault, when your weevils has one: its address and its key, kept as weevils keeps them (never over another
  # vault's key). weevils here then pushes this computer's conversations to it, encrypted.
  local vremote vkey
  vremote=$(field vault_remote); vkey=$(field vault_key)
  if [[ "$vremote" =~ ^[A-Za-z0-9@:/._~+-]+$ && "$vkey" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    if [ ! -f "$conf/vault.key" ] || [ "$(cat "$conf/vault.key")" = "$vkey" ]; then
      (umask 077; printf '%s\n' "$vkey" >"$conf/vault.key"; printf '{\n  "remote": "%s"\n}\n' "$vremote" >"$conf/vault.json")
    fi
  fi
  vkey=''
  # What to bring of this computer's history, when the line said: read once by the first import.
  if [ -n "$since$match" ]; then
    local choice=''
    [ -z "$since" ] || choice="\"since\":\"$since\""
    [ -z "$match" ] || choice="${choice:+$choice,}\"match\":\"$match\""
    (umask 077; printf '{%s}\n' "$choice" >"$conf/backfill.json")
  fi

  say "Clé acceptée. J’installe weevils ici comme machine « $id », quelques minutes…" "Key accepted. Installing weevils here as machine \"$id\", a few minutes…" # i18n-ignore
  # The installer itself, piped as everywhere else (WEEVILS_INSTALL_SH: a local copy, for tests). When it stops, it
  # writes why in $fail (line 1: the sentence, line 2: the command that fixes it), and your weevils hears it: weevboss
  # says in its thread that this computer did not install, and why, instead of waiting for it.
  local fail rc=0
  fail=$(mktemp)
  {
    if [ -n "${WEEVILS_INSTALL_SH:-}" ]; then cat "$WEEVILS_INSTALL_SH"
    else curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh; fi
  } | WEEVILS_TUNNEL_PORT=$port WEEVILS_FAIL_FILE=$fail bash -s -- --yes --lang "$lang" --secondary "$alias" --machine "$id" || rc=$?
  if [ "$rc" != 0 ]; then
    local why fix
    why=$(sed -n 1p "$fail" 2>/dev/null); fix=$(sed -n 2p "$fail" 2>/dev/null)
    [ -n "$why" ] || why="the installer stopped before the end (exit code $rc)"
    curl -fsS -m 15 --data-urlencode "id=$id" --data-urlencode "why=$why" --data-urlencode "fix=$fix" "$base/api/join/$code/failed" >/dev/null 2>&1 </dev/null || true
    rm -f "$fail"
    if [ -n "$fix" ]; then
      say "weevboss est prévenu. Une fois la commande ci-dessus lancée, demande-lui une nouvelle ligne et colle-la ici." "weevboss has been told. Once you have run the command above, ask it for a new line and paste it here." # i18n-ignore
    else
      say "weevboss est prévenu. Demande-lui une nouvelle ligne et colle-la ici pour réessayer." "weevboss has been told. Ask it for a new line and paste it here to try again." # i18n-ignore
    fi
    exit "$rc"
  fi
  rm -f "$fail"
}
main "$@"
