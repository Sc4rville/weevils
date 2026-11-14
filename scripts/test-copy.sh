#!/usr/bin/env bash
# test-copy.sh — a throwaway weevils next to a real one, that can never touch the real one.
#
#   scripts/test-copy.sh up <name> <port> [checkout]   start a copy: own HOME, own data, own tmux socket, own ports
#   scripts/test-copy.sh tmux <name> <tmux args…>      run tmux on the copy's own socket (create panes, read them…)
#   scripts/test-copy.sh down <name>                   stop the copy's server and close the copy's own sessions
#
# Why: on 2026-11-14 a hand-made script ran « TMUX_TMPDIR=$H tmux -L weevils kill-server » before $H existed. tmux
# then falls back to /tmp, so it killed the real weevils tmux server and every agent session, twice. Here:
#   - the copy's folder is created before any tmux call, under $WEEVILS_TEST_COPIES (default /tmp/weevils-test-copies);
#   - every tmux call is « tmux -S <absolute socket inside that folder> », never -L, never the default socket;
#   - there is no kill-server: « down » closes the copy's sessions one by one, on its own socket;
#   - the real ports (4179, 4180) and any socket outside the copy's folder are refused.
set -euo pipefail

ROOT=${WEEVILS_TEST_COPIES:-/tmp/weevils-test-copies}
die() { echo "test-copy: $*" >&2; exit 1; }

case "$ROOT" in /*) ;; *) die "WEEVILS_TEST_COPIES must be an absolute path" ;; esac
cmd=${1:-}; name=${2:-}
[ -n "$cmd" ] && [ -n "$name" ] || die "usage: test-copy.sh up|tmux|down <name> …"
[[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$ ]] || die "name must be letters, digits, - or _"

DIR="$ROOT/$name"
SOCKDIR="$DIR/tmux-$(id -u)"
SOCK="$SOCKDIR/weevils"

# The socket the copy's server will use (tmux -L weevils under TMUX_TMPDIR=$DIR) and the one this script uses must be
# the same absolute path, inside the copy's folder, never the user's default tmux directory.
guard_socket() {
  case "$SOCK" in "$DIR"/*) ;; *) die "socket $SOCK is outside $DIR" ;; esac
  case "$SOCK" in /tmp/tmux-*|"${TMUX_TMPDIR:-/nonexistent}"/tmux-*) die "refusing a default tmux socket: $SOCK" ;; esac
  [ -d "$SOCKDIR" ] || die "socket folder $SOCKDIR does not exist (refusing: tmux would fall back to the real server)"
}
t() { guard_socket; env -u TMUX -u TMUX_PANE tmux -S "$SOCK" "$@"; }

case "$cmd" in
  up)
    port=${3:-}; checkout=${4:-$(cd "$(dirname "$0")/.." && pwd)}
    [[ "$port" =~ ^[0-9]+$ ]] || die "port must be a number"
    { [ "$port" -ge 1024 ] && [ "$port" -le 65000 ]; } || die "port out of range"
    case "$port" in 4179|4180) die "port $port belongs to the real weevils" ;; esac
    [ -e "$DIR" ] && die "$DIR already exists: « down $name » first, or pick another name"
    mkdir -p "$DIR/projects" "$SOCKDIR"
    chmod 700 "$SOCKDIR"
    guard_socket
    [ -f "$checkout/server/index.ts" ] || die "$checkout is not a weevils checkout"
    cd "$checkout"
    env -i HOME="$DIR" PATH=/usr/bin:/bin TMUX_TMPDIR="$DIR" LANG=en_US.UTF-8 \
      WEEVILS_LANG="${WEEVILS_LANG:-en}" WEEVILS_PORT="$port" WEEVILS_HOOK_PORT=$((port + 1)) WEEVILS_ORCHESTRATOR=0 \
      WEEVILS_MACHINE=test-copy setsid node server/index.ts < /dev/null > "$DIR/server.log" 2>&1 &
    echo $! > "$DIR/server.pid"
    echo "$port" > "$DIR/port"
    echo "test copy $name: http://127.0.0.1:$port · home $DIR · tmux -S $SOCK"
    ;;
  tmux)
    shift 2
    for a in "$@"; do case "$a" in kill-server|-L|-S) die "« $a » is not allowed here" ;; esac; done
    t "$@"
    ;;
  down)
    [ -d "$DIR" ] || die "no copy named $name"
    if [ -f "$DIR/server.pid" ]; then
      pid=$(cat "$DIR/server.pid")
      # Only our own node, started from this copy's HOME.
      if [ -r "/proc/$pid/environ" ] && tr '\0' '\n' < "/proc/$pid/environ" | grep -qx "HOME=$DIR"; then kill "$pid" 2>/dev/null || true; fi
      rm -f "$DIR/server.pid"
    fi
    if [ -d "$SOCKDIR" ]; then
      for s in $(t list-sessions -F '#{session_name}' 2>/dev/null || true); do t kill-session -t "=$s:" 2>/dev/null || true; done
    fi
    echo "test copy $name stopped (folder kept: $DIR)"
    ;;
  *) die "unknown command $cmd" ;;
esac
