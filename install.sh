#!/usr/bin/env bash
# weevils installer — one command on a fresh Linux machine or VPS. Idempotent: run it again to update.
#
#   git clone https://github.com/Sc4rville/weevils && cd weevils && ./install.sh
#   curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh | bash
#   … | bash -s -- --secondary <ssh host of the main machine>      (a second machine, federated by the main one)
#
# Options: --yes  --name <first name>  --lang en|fr  --domain <host>  --port <n>  --dir <path>  --secondary <ssh-host>
#          --machine <id>  --no-update  --help
set -euo pipefail

REPO_URL=${WEEVILS_REPO:-https://github.com/Sc4rville/weevils.git}
# Where this script lives when it runs from a clone (empty when piped from curl).
SELF=${BASH_SOURCE[0]:-}
ARGS=("$@")

# ---------------------------------------------------------------- messages (English, French)

declare -A EN FR
EN[title]="weevils installer"
FR[title]="installation de weevils"
EN[usage]="usage: install.sh [--yes] [--name <first name>] [--lang en|fr] [--domain <host>] [--port <n>] [--dir <path>] [--secondary <ssh-host>] [--machine <id>] [--no-update]"
FR[usage]="usage : install.sh [--yes] [--name <prénom>] [--lang en|fr] [--domain <hôte>] [--port <n>] [--dir <dossier>] [--secondary <hôte-ssh>] [--machine <id>] [--no-update]"
EN[s_system]="checking the system"
FR[s_system]="vérification du système"
EN[not_linux]="weevils installs on Linux only. On macOS or Windows, use a Linux VPS (or WSL2)."
FR[not_linux]="weevils s'installe sur Linux uniquement. Sur macOS ou Windows, prends un VPS Linux (ou WSL2)."
EN[no_tty]="no terminal to ask questions: going on with the defaults (like --yes)"
FR[no_tty]="pas de terminal pour poser des questions : je continue avec les choix par défaut (comme --yes)"
EN[root_warn]="running as root: claude refuses to skip permissions as root. A regular user with sudo is better (adduser me && usermod -aG sudo me)."
FR[root_warn]="lancé en root : claude refuse de sauter les permissions en root. Mieux vaut un utilisateur normal avec sudo (adduser moi && usermod -aG sudo moi)."
EN[no_sudo]="installing packages needs root: run as root, or install sudo."
FR[no_sudo]="installer des paquets demande root : lance en root, ou installe sudo."
EN[no_pm]="no supported package manager (apt, dnf, pacman). Install these by hand, then run me again:"
FR[no_pm]="pas de gestionnaire de paquets connu (apt, dnf, pacman). Installe-les à la main, puis relance-moi :"
EN[missing]="missing:"
FR[missing]="manquant :"
EN[ask_pkgs]="install them now?"
FR[ask_pkgs]="je les installe ?"
EN[installing]="installing"
FR[installing]="installation de"
EN[refused]="can't go on without them. Install them, then run me again."
FR[refused]="impossible de continuer sans eux. Installe-les, puis relance-moi."
EN[node_old]="needs Node.js >= 22.18 (found:"
FR[node_old]="il faut Node.js >= 22.18 (trouvé :"
EN[ask_node]="install Node.js 22 (NodeSource)?"
FR[ask_node]="j'installe Node.js 22 (NodeSource) ?"
EN[node_hint]="install Node.js 22 or newer (https://nodejs.org), then run me again."
FR[node_hint]="installe Node.js 22 ou plus récent (https://nodejs.org), puis relance-moi."
EN[no_agent]="neither claude nor codex is installed: weevils drives them. Install at least one (then just open the app):"
FR[no_agent]="ni claude ni codex n'est installé : c'est eux que weevils pilote. Installe au moins l'un des deux (puis ouvre l'app) :"
EN[agent_login]="then log in once in a terminal: claude (or codex)"
FR[agent_login]="puis connecte-toi une fois dans un terminal : claude (ou codex)"
EN[s_source]="getting weevils"
FR[s_source]="récupération de weevils"
EN[cloning]="cloning into"
FR[cloning]="clonage dans"
EN[updating]="updating"
FR[updating]="mise à jour de"
EN[no_pull]="local changes or no upstream: keeping this version (no git pull)"
FR[no_pull]="modifs locales ou pas de branche suivie : je garde cette version (pas de git pull)"
EN[pull_failed]="git pull failed: keeping this version"
FR[pull_failed]="git pull a échoué : je garde cette version"
EN[not_repo]="exists but is not a weevils clone: pick another --dir"
FR[not_repo]="existe mais n'est pas un clone de weevils : choisis un autre --dir"
EN[s_config]="your settings"
FR[s_config]="tes réglages"
EN[ask_name]="your first name (the agents call you by it)"
FR[ask_name]="ton prénom (les agents t'appellent comme ça)"
EN[ask_domain]="domain for HTTPS, pointing to this machine (empty: none, reach it through an SSH tunnel)"
FR[ask_domain]="domaine pour le HTTPS, qui pointe vers cette machine (vide : aucun, accès par tunnel SSH)"
EN[cfg_new]="created"
FR[cfg_new]="créé"
EN[cfg_kept]="kept your values in"
FR[cfg_kept]="tes valeurs gardées dans"
EN[s_build]="dependencies and app build"
FR[s_build]="dépendances et construction de l'app"
EN[deps_ok]="dependencies up to date"
FR[deps_ok]="dépendances à jour"
EN[build_ok]="app already built for this version"
FR[build_ok]="app déjà construite pour cette version"
EN[s_service]="weevilsd service"
FR[s_service]="service weevilsd"
EN[bg_mode]="no systemd here (container, WSL…): weevilsd runs in the background, without auto-start at boot. Control it with: weevils-service start|stop|status|logs"
FR[bg_mode]="pas de systemd ici (conteneur, WSL…) : weevilsd tourne en arrière-plan, sans démarrage auto au boot. Pour le piloter : weevils-service start|stop|status|logs"
EN[cron_added]="auto-start at boot added to your crontab (@reboot)"
FR[cron_added]="démarrage au boot ajouté à ta crontab (@reboot)"
EN[s_https]="HTTPS with Caddy"
FR[s_https]="HTTPS avec Caddy"
EN[caddy_nopm]="Caddy installs here with apt only: install it by hand (https://caddyserver.com/docs/install), then run me again."
FR[caddy_nopm]="Caddy s'installe ici avec apt seulement : installe-le à la main (https://caddyserver.com/docs/install), puis relance-moi."
EN[caddy_bad]="Caddy refuses the new config: previous Caddyfile restored, HTTPS skipped."
FR[caddy_bad]="Caddy refuse la nouvelle config : ancien Caddyfile remis, HTTPS laissé de côté."
EN[caddy_dns]="the domain must point to this machine (DNS A/AAAA record) and ports 80 and 443 must be open."
FR[caddy_dns]="le domaine doit pointer vers cette machine (enregistrement DNS A/AAAA) et les ports 80 et 443 doivent être ouverts."
EN[waiting]="waiting for weevilsd"
FR[waiting]="j'attends weevilsd"
EN[down]="weevilsd does not answer. Look at: weevils-service status, weevils-service logs"
FR[down]="weevilsd ne répond pas. Regarde : weevils-service status, weevils-service logs"
EN[ready]="weevils is ready"
FR[ready]="weevils est prêt"
EN[address]="address"
FR[address]="adresse"
EN[code]="access code"
FR[code]="code d'accès"
EN[link]="login link"
FR[link]="lien de connexion"
EN[tunnel]="weevilsd listens on 127.0.0.1 only. From your computer, open a tunnel, then the link above:"
FR[tunnel]="weevilsd n'écoute que sur 127.0.0.1. Depuis ton ordi, ouvre un tunnel, puis le lien ci-dessus :"
EN[tunnel2]="for your phone, run me again with --domain <host> (HTTPS)."
FR[tunnel2]="pour ton téléphone, relance-moi avec --domain <hôte> (HTTPS)."
EN[next]="next: open the link on your phone, then Share → Add to Home Screen."
FR[next]="ensuite : ouvre le lien sur ton téléphone, puis Partager → Sur l'écran d'accueil."
EN[secondary_ok]="this machine reports to"
FR[secondary_ok]="cette machine remonte vers"
EN[secondary_next]="its sessions show up in the app of the main machine. Start one here with: wv"
FR[secondary_next]="ses sessions apparaissent dans l'app de la machine principale. Lances-en une ici avec : wv"
EN[ssh_fail]="can't reach the main machine without a password. Set up an SSH key, then run me again:"
FR[ssh_fail]="impossible de joindre la machine principale sans mot de passe. Mets une clé SSH en place, puis relance-moi :"
EN[yes]="Y/n"
FR[yes]="O/n"

# ---------------------------------------------------------------- options

YES=0 NAME='' LANG_OPT='' DOMAIN='' PORT='' DIR='' SECONDARY='' MACHINE='' NO_UPDATE=${WEEVILS_NO_UPDATE:-0}
while [ $# -gt 0 ]; do
  case "$1" in
    -y | --yes) YES=1 ;;
    --name) NAME=${2:?--name}; shift ;;
    --lang) LANG_OPT=${2:?--lang}; shift ;;
    --domain) DOMAIN=${2:?--domain}; shift ;;
    --port) PORT=${2:?--port}; shift ;;
    --dir) DIR=${2:?--dir}; shift ;;
    --secondary) SECONDARY=${2:?--secondary}; shift ;;
    --machine) MACHINE=${2:?--machine}; shift ;;
    --no-update) NO_UPDATE=1 ;;
    -h | --help) sed -n 2,10p "${SELF:-/dev/null}" 2>/dev/null | sed 's/^# \{0,1\}//'; HELP=1 ;;
    *) echo "unknown option: $1" >&2; BAD=1 ;;
  esac
  shift
done

if [ -n "$LANG_OPT" ]; then L=$LANG_OPT
else case "${LC_ALL:-${LANG:-}}" in fr*) L=fr ;; *) L=en ;; esac; fi
[ "$L" = fr ] || L=en
t() { if [ "$L" = fr ]; then printf '%s' "${FR[$1]}"; else printf '%s' "${EN[$1]}"; fi; }

# ---------------------------------------------------------------- output

if [ -t 1 ]; then B=$'\e[1m' D=$'\e[2m' R=$'\e[0m' Y=$'\e[30;43m' G=$'\e[32m' O=$'\e[33m' E=$'\e[31m' M=$'\e[35m'
else B='' D='' R='' Y='' G='' O='' E='' M=''; fi
step() { printf '\n%s %s %s\n' "$Y$B" "$1" "$R"; }
ok() { printf '  %s✓%s %s\n' "$G" "$R" "$*"; }
info() { printf '  %s·%s %s\n' "$D" "$R" "$*"; }
warn() { printf '  %s!%s %s\n' "$O$B" "$R" "$*"; }
die() { printf '  %s✗ %s%s\n' "$E$B" "$*" "$R" >&2; exit 1; }

# Questions go through the terminal even when the script comes from curl | bash.
TTY=0
if [ "$YES" = 0 ] && { : </dev/tty; } 2>/dev/null; then TTY=1; fi
confirm() { # confirm "question" → 0 = yes
  [ "$YES" = 1 ] || [ "$TTY" = 0 ] && return 0
  local a; printf '  %s?%s %s [%s] ' "$M$B" "$R" "$1" "$(t yes)" >/dev/tty; read -r a </dev/tty || a=''
  case "$a" in '' | y* | Y* | o* | O*) return 0 ;; *) return 1 ;; esac
}
ask() { # ask "question" default → answer on stdout
  if [ "$YES" = 1 ] || [ "$TTY" = 0 ]; then printf '%s' "$2"; return; fi
  local a; printf '  %s?%s %s%s: ' "$M$B" "$R" "$1" "${2:+ [$2]}" >/dev/tty; read -r a </dev/tty || a=''
  printf '%s' "${a:-$2}"
}

# ---------------------------------------------------------------- system

SUDO=''
PM=''
APT_UPDATED=0
# quiet cmd… — runs a noisy command, shows its output only when it fails.
quiet() {
  local log; log=$(mktemp)
  if "$@" >"$log" 2>&1; then rm -f "$log"; else local rc=$?; tail -n 30 "$log" >&2; rm -f "$log"; return "$rc"; fi
}
pkg_install() { # pkg_install pkg… (names for the detected package manager)
  info "$(t installing) $*"
  case "$PM" in
    apt)
      if [ "$APT_UPDATED" = 0 ]; then quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq; APT_UPDATED=1; fi
      quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@" ;;
    dnf) quiet $SUDO dnf install -y -q "$@" ;;
    pacman) quiet $SUDO pacman -Sy --noconfirm --needed "$@" ;;
  esac
}

node_ok() {
  command -v node >/dev/null || return 1
  local v; v=$(node -p 'process.versions.node' 2>/dev/null) || return 1
  local maj=${v%%.*} rest=${v#*.}; local min=${rest%%.*}
  [ "$maj" -gt 22 ] || { [ "$maj" = 22 ] && [ "$min" -ge 18 ]; }
}

check_system() {
  step "$(t s_system)"
  [ "$(uname -s)" = Linux ] || die "$(t not_linux)"
  [ "$TTY" = 1 ] || [ "$YES" = 1 ] || info "$(t no_tty)"
  if [ "$(id -u)" = 0 ]; then warn "$(t root_warn)"
  elif command -v sudo >/dev/null; then SUDO=sudo
  else SUDO=none; fi
  if command -v apt-get >/dev/null; then PM=apt
  elif command -v dnf >/dev/null; then PM=dnf
  elif command -v pacman >/dev/null; then PM=pacman; fi

  # Commands weevils needs, then the package that brings each one.
  local need=(git curl tmux jq python3) missing=() pkgs=()
  [ -n "$SECONDARY" ] && need+=(ssh)
  for c in "${need[@]}"; do command -v "$c" >/dev/null || missing+=("$c"); done
  # systemd --user needs the user bus; the QR code on the end screen needs qrencode (optional, apt only).
  local extra=()
  if [ "$PM" = apt ]; then
    [ -d /run/systemd/system ] && ! dpkg -s dbus-user-session >/dev/null 2>&1 && extra+=(dbus-user-session)
    command -v qrencode >/dev/null || extra+=(qrencode)
    dpkg -s ca-certificates >/dev/null 2>&1 || extra+=(ca-certificates)
  fi
  for c in "${missing[@]}"; do
    case "$c:$PM" in
      ssh:pacman | ssh:dnf) pkgs+=(openssh-clients) ;;
      ssh:*) pkgs+=(openssh-client) ;;
      *) pkgs+=("$c") ;;
    esac
  done
  [ "$PM" = pacman ] && pkgs=("${pkgs[@]/openssh-clients/openssh}")
  if [ ${#missing[@]} -gt 0 ]; then
    warn "$(t missing) ${missing[*]}"
    [ -n "$PM" ] || die "$(t no_pm) ${missing[*]}"
    [ "$SUDO" != none ] || die "$(t no_sudo)"
    confirm "$(t ask_pkgs)" || die "$(t refused)"
  fi
  if [ ${#pkgs[@]} -gt 0 ] || [ ${#extra[@]} -gt 0 ]; then
    [ "$SUDO" != none ] || { [ ${#pkgs[@]} -eq 0 ] || die "$(t no_sudo)"; }
    [ "$SUDO" = none ] || pkg_install ${pkgs[@]+"${pkgs[@]}"} ${extra[@]+"${extra[@]}"}
  fi
  for c in "${need[@]}"; do command -v "$c" >/dev/null || die "$(t missing) $c"; done
  ok "git, curl, tmux, jq, python3"

  if ! node_ok; then
    warn "$(t node_old) $(node -v 2>/dev/null || echo —))"
    if [ "$PM" = apt ] || [ "$PM" = dnf ] || [ "$PM" = pacman ]; then
      [ "$SUDO" != none ] || die "$(t no_sudo)"
      confirm "$(t ask_node)" || die "$(t node_hint)"
      case "$PM" in
        apt) curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
          quiet $SUDO bash /tmp/nodesource_setup.sh
          quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs ;;
        dnf) curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
          quiet $SUDO bash /tmp/nodesource_setup.sh
          quiet $SUDO dnf install -y -q nodejs ;;
        pacman) pkg_install nodejs npm ;;
      esac
      hash -r
      node_ok || die "$(t node_hint)"
    else die "$(t node_hint)"; fi
  fi
  command -v npm >/dev/null || { [ "$PM" = apt ] && pkg_install npm; command -v npm >/dev/null || die "npm: $(t node_hint)"; }
  ok "node $(node -v), npm $(npm -v)"

  local agents=()
  command -v claude >/dev/null && agents+=("claude $(claude --version 2>/dev/null | head -1 | awk '{print $1}' || true)")
  command -v codex >/dev/null && agents+=("codex")
  if [ ${#agents[@]} -eq 0 ]; then
    warn "$(t no_agent)"
    info "npm i -g @anthropic-ai/claude-code     # Claude Code"
    info "npm i -g @openai/codex                 # Codex"
    info "$(t agent_login)"
  else ok "${agents[*]}"; fi
}

# ---------------------------------------------------------------- source

get_source() {
  step "$(t s_source)"
  local here=''
  if [ -n "$SELF" ] && [ -f "$SELF" ]; then
    here=$(cd "$(dirname "$SELF")" && pwd)
    [ -f "$here/server/install.sh" ] && [ -f "$here/package.json" ] || here=''
  fi
  if [ -z "$DIR" ] && [ -n "$here" ]; then DIR=$here; fi
  DIR=${DIR:-$HOME/weevils}
  case "$DIR" in /*) ;; *) DIR=$PWD/$DIR ;; esac

  if [ ! -e "$DIR" ]; then
    info "$(t cloning) $DIR"
    git clone -q "$REPO_URL" "$DIR"
  elif [ -f "$DIR/server/install.sh" ] && [ -d "$DIR/.git" ]; then
    if [ "$NO_UPDATE" = 0 ]; then
      if [ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] && git -C "$DIR" rev-parse -q --verify '@{u}' >/dev/null 2>&1; then
        info "$(t updating) $DIR"
        local before; before=$(git -C "$DIR" rev-parse HEAD)
        if git -C "$DIR" pull -q --ff-only; then
          # A newer installer came with the update: hand over to it.
          if [ "$before" != "$(git -C "$DIR" rev-parse HEAD)" ] && ! git -C "$DIR" diff --quiet "$before" HEAD -- install.sh; then
            WEEVILS_NO_UPDATE=1 exec bash "$DIR/install.sh" ${ARGS[@]+"${ARGS[@]}"} --dir "$DIR"
          fi
        else warn "$(t pull_failed)"; fi
      else info "$(t no_pull)"; fi
    fi
  else die "$DIR $(t not_repo)"; fi
  ok "$DIR ($(git -C "$DIR" log -1 --format='%h %cs' 2>/dev/null || echo '?'))"
}

# ---------------------------------------------------------------- config

slug() { tr 'A-Z' 'a-z' <<<"$1" | tr -c 'a-z0-9-\n' '-' | sed 's/^-*//; s/-*$//' | cut -c1-20; }

configure() {
  step "$(t s_config)"
  local svc="$DIR/server/weevils-service" conf=${XDG_CONFIG_HOME:-$HOME/.config}/weevils/env fresh=0
  cfg() { "$svc" config "$@"; }
  mkdir -p "$(dirname "$conf")"
  if [ ! -f "$conf" ]; then
    install -m 600 "$DIR/weevils.env.example" "$conf"
    fresh=1
  fi
  # A flag given now updates its key; otherwise a value already there is never overwritten.
  local name=$NAME
  if [ -z "$name" ] && [ -z "$(cfg get WEEVILS_USER_NAME)" ]; then name=$(ask "$(t ask_name)" ""); fi
  [ -z "$name" ] || cfg set WEEVILS_USER_NAME "$name"
  if [ -n "$LANG_OPT" ]; then cfg set WEEVILS_LANG "$L"; else cfg default WEEVILS_LANG "$L"; fi
  if [ -n "$PORT" ]; then cfg set WEEVILS_PORT "$PORT"; else cfg default WEEVILS_PORT 4179; fi
  cfg default WEEVILS_HOOK_PORT 4180
  if [ -z "$SECONDARY" ] && [ -z "$DOMAIN" ] && [ -z "$(cfg get WEEVILS_PUBLIC_URL)" ]; then DOMAIN=$(ask "$(t ask_domain)" ""); fi
  [ -z "$DOMAIN" ] || cfg set WEEVILS_PUBLIC_URL "https://$DOMAIN"
  # The machine id: only on a new config (an older one keeps the id it already had), or when --machine is given.
  local host; host=$(slug "$(hostname -s 2>/dev/null || cat /etc/hostname)")
  if [ -n "$MACHINE" ]; then cfg set WEEVILS_MACHINE "$(slug "$MACHINE")"; cfg set WEEVILS_MACHINE_NAME "$MACHINE"
  elif [ "$fresh" = 1 ] || [ -n "$SECONDARY" ]; then cfg default WEEVILS_MACHINE "${host:-main}"; cfg default WEEVILS_MACHINE_NAME "${host:-main}"; fi
  # The access code (weevilsd would create it too): here, so the end screen always has it.
  local secret=${XDG_CONFIG_HOME:-$HOME/.config}/weevils/secret
  [ -s "$secret" ] || (umask 077 && head -c 9 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' >"$secret")
  if [ "$fresh" = 1 ]; then ok "$(t cfg_new) $conf"; else ok "$(t cfg_kept) $conf"; fi
  info "WEEVILS_USER_NAME=$(cfg get WEEVILS_USER_NAME)  WEEVILS_LANG=$(cfg get WEEVILS_LANG)  WEEVILS_PORT=$(cfg get WEEVILS_PORT)  WEEVILS_MACHINE=$(cfg get WEEVILS_MACHINE)"
}

# ---------------------------------------------------------------- build

build() {
  step "$(t s_build)"
  cd "$DIR"
  local omit='' stamp
  [ -n "$SECONDARY" ] && omit=--omit=dev
  stamp="$(sha256sum package-lock.json | cut -c1-16) $(node -v) $omit"
  if [ -f node_modules/.weevils-stamp ] && [ "$(cat node_modules/.weevils-stamp)" = "$stamp" ]; then ok "$(t deps_ok)"
  else
    quiet npm ci --no-audit --no-fund --no-update-notifier $omit
    echo "$stamp" >node_modules/.weevils-stamp
    ok "npm ci"
  fi
  # A secondary machine serves no app: only the main one builds it.
  [ -z "$SECONDARY" ] || return 0
  stamp="$(git rev-parse HEAD 2>/dev/null) $(git status --porcelain 2>/dev/null | sha256sum | cut -c1-16)"
  if [ -f dist/index.html ] && [ -f dist/.weevils-stamp ] && [ "$(cat dist/.weevils-stamp)" = "$stamp" ]; then ok "$(t build_ok)"
  else
    quiet npx --no-update-notifier vite build
    echo "$stamp" >dist/.weevils-stamp
    ok "vite build → dist/"
  fi
}

# ---------------------------------------------------------------- service

service() {
  step "$(t s_service)"
  if [ -n "$SECONDARY" ]; then
    ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$SECONDARY" true 2>/dev/null || {
      warn "$(t ssh_fail)"
      info "ssh-keygen -t ed25519 && ssh-copy-id $SECONDARY"
      exit 1
    }
    bash "$DIR/server/install.sh" secondary "$SECONDARY" | sed 's/^/  · /'
  else
    bash "$DIR/server/install.sh" main | sed 's/^/  · /'
  fi
  if [ "$("$DIR/server/weevils-service" mode)" != systemd ]; then
    warn "$(t bg_mode)"
    if command -v crontab >/dev/null && ! crontab -l 2>/dev/null | grep -q 'weevils-service start'; then
      { crontab -l 2>/dev/null || true; echo "@reboot $HOME/.local/bin/weevils-service start"; } | crontab - && info "$(t cron_added)"
    fi
  fi
}

# ---------------------------------------------------------------- HTTPS

https() {
  [ -n "$DOMAIN" ] && [ -z "$SECONDARY" ] || return 0
  step "$(t s_https)"
  [ "$SUDO" != none ] || die "$(t no_sudo)"
  local port; port=$("$DIR/server/weevils-service" config get WEEVILS_PORT)
  if ! command -v caddy >/dev/null; then
    [ "$PM" = apt ] || die "$(t caddy_nopm)"
    pkg_install debian-keyring debian-archive-keyring apt-transport-https gnupg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    APT_UPDATED=0
    pkg_install caddy
  fi
  ok "$(caddy version 2>/dev/null | awk '{print "caddy " $1}')"
  # Our site in its own file; the Caddyfile only imports it. An existing Caddyfile keeps all its sites.
  local site=/etc/caddy/weevils.caddy cf=/etc/caddy/Caddyfile tls=''
  [ "${WEEVILS_CADDY_TLS:-}" = internal ] && tls=$'\n\ttls internal'
  $SUDO mkdir -p /etc/caddy
  printf '# weevils — written by install.sh\n%s {%s\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$tls" "$port" | $SUDO tee "$site" >/dev/null
  local backup=''
  if [ -f "$cf" ]; then
    backup=$cf.bak-weevils
    $SUDO cp "$cf" "$backup"
  fi
  if [ ! -f "$cf" ] || grep -q 'The Caddyfile is an easy way to practice' "$cf"; then
    # No Caddyfile, or the untouched placeholder of the package: ours replaces it (backup kept).
    printf 'import %s\n' "$site" | $SUDO tee "$cf" >/dev/null
  elif ! grep -qE "^[[:space:]]*import[[:space:]]+$site" "$cf"; then
    printf '\nimport %s\n' "$site" | $SUDO tee -a "$cf" >/dev/null
  fi
  if ! $SUDO caddy validate --config "$cf" --adapter caddyfile >/dev/null 2>&1; then
    if [ -n "$backup" ]; then $SUDO cp "$backup" "$cf"; else $SUDO rm -f "$cf"; fi
    warn "$(t caddy_bad)"
    DOMAIN=''
    return 0
  fi
  if [ -d /run/systemd/system ]; then
    $SUDO systemctl enable caddy >/dev/null 2>&1 || true
    $SUDO systemctl reload-or-restart caddy
  else
    $SUDO caddy reload --config "$cf" --adapter caddyfile >/dev/null 2>&1 || $SUDO caddy start --config "$cf" --adapter caddyfile >/dev/null 2>&1
  fi
  ok "https://$DOMAIN → 127.0.0.1:$port"
  info "$(t caddy_dns)"
}

# ---------------------------------------------------------------- end screen

finish() {
  local svc="$DIR/server/weevils-service" port code url host_cfg
  port=$("$svc" config get WEEVILS_PORT); port=${port:-4179}
  if [ -n "$SECONDARY" ]; then
    step "$(t ready)"
    ok "$(t secondary_ok) $SECONDARY"
    info "$(t secondary_next)"
    return 0
  fi
  step "$(t waiting)"
  local up=0
  for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:$port/api/me" >/dev/null 2>&1 && { up=1; break; }; sleep 0.5; done
  [ "$up" = 1 ] || die "$(t down)"
  ok "http://127.0.0.1:$port"

  code=$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/weevils/secret")
  host_cfg=$("$svc" config get WEEVILS_HOST)
  if [ -n "$DOMAIN" ]; then url=https://$DOMAIN
  elif [ -n "$("$svc" config get WEEVILS_PUBLIC_URL)" ]; then url=$("$svc" config get WEEVILS_PUBLIC_URL)
  elif [ -n "$host_cfg" ] && [ "$host_cfg" != 127.0.0.1 ]; then url=http://$(hostname -I 2>/dev/null | awk '{print $1}'):$port
  else url=http://localhost:$port; fi
  url=${url%/}

  step "$(t ready)"
  printf '\n  %s : %s%s%s\n' "$(t address)" "$B" "$url" "$R"
  printf '  %s : %s%s%s\n' "$(t code)" "$B$M" "$code" "$R"
  printf '  %s : %s\n\n' "$(t link)" "$url/#k=$code"
  if command -v qrencode >/dev/null; then qrencode -t ANSIUTF8 -m 2 "$url/#k=$code" | sed 's/^/  /'; echo; fi
  if [ "$url" = "http://localhost:$port" ]; then
    info "$(t tunnel)"
    info "ssh -L $port:127.0.0.1:$port ${USER:-$(id -un)}@$(hostname -I 2>/dev/null | awk '{print $1}')"
    info "$(t tunnel2)"
  fi
  info "$(t next)"
  echo
}

main() {
  [ -z "${HELP:-}" ] || { echo "$(t usage)"; exit 0; }
  [ -z "${BAD:-}" ] || { echo "$(t usage)" >&2; exit 2; }
  printf '%s weevils %s %s\n' "$Y$B" "$R" "$(t title)"
  check_system
  get_source
  configure
  build
  service
  https
  finish
}

# Everything above is only definitions: nothing runs before the whole script is downloaded and parsed.
main
