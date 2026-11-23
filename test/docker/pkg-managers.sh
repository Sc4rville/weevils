#!/usr/bin/env bash
# install.sh's package step for real, on every Linux family it knows, each in a blank container: it installs only what
# is missing, never upgrades the system, and when it cannot, ends on one plain sentence and the one command to run.
# Ends with PASS or FAIL.
#
#   test/docker/pkg-managers.sh [arch|arch-conflict|ubuntu|fedora|opensuse|alpine]…   (none: all)
#
# Each run is the real installer (this working tree's install.sh, run as a user with sudo, --yes) with a repository
# that does not exist: it goes through the system check (packages, Node.js) for real, then stops at "getting weevils",
# which shows the plain failure. Claude Code and Codex are stubs.
#   arch            CachyOS's case: a package held back (IgnorePkg) whose library moves on, so a system upgrade
#                   (pacman -Syu) fails; and no package database yet (a fresh install: pacman -Sy once, for these
#                   packages only). The installer must install tmux, jq… and leave the held pair as it was.
#   arch-conflict   jq cannot be installed (an installed package conflicts with it): one sentence naming jq and
#                   "sudo pacman -S --needed jq", no pacman output.
#   ubuntu fedora opensuse alpine   apt, dnf, zypper, apk: what was installed before keeps its version.
# KEEP=1 keeps the containers.
set -uo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
which=("$@")
[ ${#which[@]} -gt 0 ] || which=(arch arch-conflict ubuntu fedora opensuse alpine)
tag=$$
work=$(mktemp -d)
containers=()
images=()
fails=0
passes=0
cleanup() {
  if [ "${KEEP:-0}" = 1 ]; then echo "kept: ${containers[*]:-}"; else
    for c in "${containers[@]}"; do docker rm -f "$c" >/dev/null 2>&1; done
    for i in "${images[@]}"; do docker image rm "$i" >/dev/null 2>&1; done
  fi
  rm -rf "$work"
}
trap cleanup EXIT
say() { printf '\n\e[30;43m %s \e[0m\n' "$*"; }
run_heavy() { if command -v heavy >/dev/null 2>&1; then heavy "$@"; else "$@"; fi; }
check() { # check "description" command…
  local d=$1; shift
  if "$@" >"$work/out" 2>&1; then passes=$((passes + 1)); printf '  \e[32mok\e[0m   %s\n' "$d"
  else fails=$((fails + 1)); printf '  \e[31mFAIL\e[0m %s\n' "$d"; sed 's/^/       /' "$work/out" | tail -20; fi
}
inside() { docker exec "$c" bash -c "$1"; }
as_me() { docker exec -u me -w /home/me "$c" bash -c "$1"; }

# start <image> <setup as root…>: a container with bash, sudo and a user "me" who may sudo without a password.
start() {
  c=wv-pkg-$1-$tag
  containers+=("$c")
  docker run -d --name "$c" "$2" sleep infinity >/dev/null || return 1
  docker exec "$c" sh -c "$3" >"$work/setup.log" 2>&1 || { tail -20 "$work/setup.log"; return 1; }
  docker exec "$c" sh -c 'id me >/dev/null 2>&1 || useradd -m -s /bin/bash me
    usermod -p "*" me 2>/dev/null || true
    mkdir -p /etc/sudoers.d && echo "me ALL=(ALL) NOPASSWD: ALL" >/etc/sudoers.d/me && chmod 440 /etc/sudoers.d/me
    printf "#!/bin/sh\necho \"2.0.0 (Claude Code)\"\n" >/usr/local/bin/claude
    printf "#!/bin/sh\necho codex-cli 0.1\n" >/usr/local/bin/codex
    chmod 755 /usr/local/bin/claude /usr/local/bin/codex'
  docker cp "$root/install.sh" "$c:/home/me/install.sh" >/dev/null
  docker exec "$c" chown me /home/me/install.sh
}
# The installer as a person pastes it, with a repository that does not exist (it stops at "getting weevils").
install() {
  as_me 'GIT_TERMINAL_PROMPT=0 WEEVILS_REPO=https://127.0.0.1:9/nope.git bash install.sh --yes --lang en' >"$work/$1.out" 2>&1
  echo $? >"$work/$1.rc"
  sed 's/^/     | /' "$work/$1.out" | tail -25
}
versions() { # name=version of every installed package
  case $1 in
    pacman) inside "pacman -Q | tr ' ' '='" ;;
    apt) inside "dpkg-query -W -f='\${Package}=\${Version}\n'" ;;
    rpm) inside "rpm -qa --qf '%{NAME}=%{VERSION}-%{RELEASE}\n'" ;;
    apk) inside "apk info -v 2>/dev/null | sed -E 's/-([0-9][^-]*-r[0-9]+)$/=\1/'" ;;
  esac | grep -v '^gpg-pubkey=' | LC_ALL=C sort -t '=' -k1,1
}
# Packages that were there before and changed version.
changed() { LC_ALL=C join -t '=' -j1 "$work/before" "$work/after" | awk -F= '$2 != $3 { print $1 " " $2 " -> " $3 }'; }
tools_there() { as_me 'PATH=$HOME/.local/bin:$PATH; for c in git curl tmux jq python3 node npm; do command -v $c >/dev/null || { echo "missing $c"; exit 1; }; done; tmux -V; node -v'; }
stopped_plainly() { # the run ended on the plain sentence about getting weevils, not on a package
  [ "$(cat "$work/$1.rc")" != 0 ] && grep -q 'the installation stopped at this step: getting weevils' "$work/$1.out" && ! grep -q 'could not install a package' "$work/$1.out"
}

# ---------------------------------------------------------------- Arch: a held package, no database yet

# Two packages built here: lib-weevtest 1 (libweevtest.so=1) and app-weevtest 1 that needs it, installed; version 2
# of both in a local repository, app-weevtest held back. That is the hyprland/aquamarine case.
ARCH_SETUP='set -e
pacman -Sy --noconfirm --needed sudo base-devel >/dev/null
useradd -m -s /bin/bash me
mkdir -p /build /repo && chown me /build /repo
mk() { # mk name version provides depends
  mkdir -p /build/$1-$2 && cd /build/$1-$2
  printf "pkgname=%s\npkgver=%s\npkgrel=1\narch=(any)\nprovides=(%s)\ndepends=(%s)\npackage() { mkdir -p \"\$pkgdir/usr/share/%s\"; echo %s >\"\$pkgdir/usr/share/%s/v\"; }\n" "$1" "$2" "$3" "$4" "$1" "$2" "$1" >PKGBUILD
  chown -R me . && su me -c "makepkg -d --noconfirm >/dev/null 2>&1" && ls $PWD/*.pkg.tar.zst
}
pacman -U --noconfirm $(mk lib-weevtest 1 libweevtest.so=1 "") >/dev/null
pacman -U --noconfirm $(mk app-weevtest 1 "" libweevtest.so=1) >/dev/null
cp $(mk lib-weevtest 2 libweevtest.so=2 "") $(mk app-weevtest 2 "" libweevtest.so=2) /repo/
repo-add -q /repo/weevtest.db.tar.gz /repo/*.pkg.tar.zst
sed -i "s/^#\?IgnorePkg.*/IgnorePkg = app-weevtest/" /etc/pacman.conf
printf "\n[weevtest]\nSigLevel = Optional TrustAll\nServer = file:///repo\n" >>/etc/pacman.conf
pacman -Sy >/dev/null'

if printf '%s\n' "${which[@]}" | grep -qE '^arch'; then
  say "Arch Linux: a base with a held-back package"
  base=wv-pkg-archbase-$tag
  if start archbase archlinux:latest "$ARCH_SETUP"; then
    docker commit "$c" "$base" >/dev/null && images+=("$base")
  else echo "  FAIL arch setup"; fails=$((fails + 1)); fi
fi

if printf '%s\n' "${which[@]}" | grep -qx arch && docker image inspect "$base" >/dev/null 2>&1; then
  say "arch: CachyOS's case"
  start arch "$base" 'true'
  check "what the old installer ran fails here, as on CachyOS" bash -c "! docker exec -u me $c sudo pacman -Syu --noconfirm --needed tmux >$work/syu.out 2>&1 && grep -q 'breaks dependency' $work/syu.out && cat $work/syu.out"
  # No package database at all, as after some fresh installs: the installer must refresh it once.
  inside 'rm -f /var/lib/pacman/sync/core.db /var/lib/pacman/sync/extra.db'
  logn=$(inside 'wc -l </var/log/pacman.log')
  versions pacman >"$work/before"
  install arch
  versions pacman >"$work/after"
  check "git, tmux, jq, python3, node, npm installed" tools_there
  check "the held pair is untouched (app-weevtest 1, lib-weevtest 1)" bash -c "grep -qx 'app-weevtest=1-1' $work/after && grep -qx 'lib-weevtest=1-1' $work/after"
  check "no system upgrade: pacman never ran with -u" bash -c "docker exec $c tail -n +$((logn + 1)) /var/log/pacman.log | grep 'Running' && ! docker exec $c tail -n +$((logn + 1)) /var/log/pacman.log | grep -E 'Running .pacman .*-S[a-z]*u'"
  echo "     packages that changed version (dependencies only): $(changed | wc -l)"; changed | sed 's/^/       /' | head -10
  check "ends on one plain sentence, at getting weevils" stopped_plainly arch
fi

if printf '%s\n' "${which[@]}" | grep -qx arch-conflict && docker image inspect "$base" >/dev/null 2>&1; then
  say "arch-conflict: jq cannot be installed"
  start arch-conflict "$base" 'set -e
    pacman -S --noconfirm --needed tmux git python >/dev/null
    mkdir -p /build/blocker && cd /build/blocker && chown me .
    printf "pkgname=blocker\npkgver=1\npkgrel=1\narch=(any)\nconflicts=(jq)\npackage() { mkdir -p \"\$pkgdir/usr/share/blocker\"; }\n" >PKGBUILD
    su me -c "makepkg --noconfirm >/dev/null 2>&1" && pacman -U --noconfirm /build/blocker/*.pkg.tar.zst >/dev/null'
  install arch-conflict
  check "stops on jq, in one sentence, with the command" bash -c "grep -q 'weevils could not install a package it needs on this computer: jq\.' $work/arch-conflict.out && grep -q 'sudo pacman -S --needed jq\$' $work/arch-conflict.out"
  check "no pacman output on screen" bash -c "! grep -qiE 'conflict|error:|warning:' $work/arch-conflict.out"
  check "the full output is kept aside" docker exec "$c" grep -qi 'conflict' /home/me/.cache/weevils/packages.log
fi

# ---------------------------------------------------------------- the other families

other() { # other <name> <image> <versions kind> <setup>
  printf '%s\n' "${which[@]}" | grep -qx "$1" || return 0
  say "$1 ($2)"
  start "$1" "$2" "$4" || { echo "  FAIL setup"; fails=$((fails + 1)); return; }
  versions "$3" >"$work/before"
  install "$1"
  versions "$3" >"$work/after"
  check "git, tmux, jq, python3, node, npm installed" tools_there
  check "nothing installed before changed version" bash -c "export LC_ALL=C; [ -z \"\$(join -t '=' -j1 $work/before $work/after | awk -F= '\$2 != \$3')\" ] || { join -t '=' -j1 $work/before $work/after | awk -F= '\$2 != \$3'; exit 1; }"
  check "ends on one plain sentence, at getting weevils" stopped_plainly "$1"
}
other ubuntu ubuntu:24.04 apt 'apt-get update -qq && apt-get install -y -qq sudo >/dev/null'
other fedora fedora:latest rpm 'dnf install -y -q sudo >/dev/null'
other opensuse opensuse/tumbleweed:latest rpm 'zypper -n -q install sudo shadow >/dev/null'
other alpine alpine:latest apk 'apk add -q bash sudo shadow'

echo
if [ "$fails" = 0 ]; then printf '\e[32mPASS\e[0m %s checks\n' "$passes"; else printf '\e[31mFAIL\e[0m %s of %s checks\n' "$fails" "$((fails + passes))"; exit 1; fi
