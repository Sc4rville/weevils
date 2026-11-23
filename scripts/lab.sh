#!/usr/bin/env bash
# lab.sh — the onboarding lab (docs/onboarding-lab.md): play a newcomer through weevils' real onboarding on a blank
# instance, and change the onboarding while you play it. A green switch by weevboss's field turns what you send into a
# remark; an agent on this machine changes the code in the lab worktree, checks and builds it, the instance restarts
# on it and plays the step again. A dev tool for whoever builds weevils: nothing of it runs in a normal install.
#
#   scripts/lab.sh up [--port 4187] [--url https://lab.example.com] [--remote public] [--model opus]
#                        the worktree (branch lab/onboarding, from <remote>/main), its build, the blank instance (its
#                        code is the worktree, Claude not signed in, a lent sign-in for questions), the watcher; the link
#   scripts/lab.sh link | status | logs | stop
#
# Settings: LAB_TREE (default ~/projects/weevils-lab), the lab folder ~/.local/state/weevils-lab (remarks, results,
# the watcher's log). The instance listens on 127.0.0.1:<port>: put a reverse proxy in front for a phone.
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
tree=${LAB_TREE:-$HOME/projects/weevils-lab}
dir=${XDG_STATE_HOME:-$HOME/.local/state}/weevils-lab
name=weevils-lab
export FRESH_NAME=$name
mkdir -p "$dir"
port=4187 url='' remote=public model=opus
[ -f "$dir/settings" ] && . "$dir/settings"

watching() { [ -s "$dir/watch.pid" ] && kill -0 "$(cat "$dir/watch.pid")" 2>/dev/null; }
start_watch() {
  watching && return
  nohup node "$tree/scripts/lab/watch.mjs" --worktree "$tree" --lab "$dir" --name "$name" --port "$port" --remote "$remote" --model "$model" >>"$dir/watch.log" 2>&1 &
  echo $! >"$dir/watch.pid"
}

cmd=${1:-status}
shift || true
case "$cmd" in
  up)
    while [ $# -gt 0 ]; do
      case "$1" in
        --port) port=$2; shift ;;
        --url) url=${2%/}; shift ;;
        --remote) remote=$2; shift ;;
        --model) model=$2; shift ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
      esac
      shift
    done
    printf 'port=%q\nurl=%q\nremote=%q\nmodel=%q\n' "$port" "$url" "$remote" "$model" >"$dir/settings"
    if [ ! -d "$tree" ]; then
      git -C "$root" fetch -q "$remote" main
      git -C "$root" worktree add -q -B lab/onboarding "$tree" "$remote/main"
    fi
    (cd "$tree" && { [ -d node_modules ] || npm ci --include=dev --no-audit --no-fund >/dev/null; } && npx vite build >/dev/null && npx vite build -c next/vite.config.ts >/dev/null)
    "$tree/scripts/fresh.sh" up --port "$port" ${url:+--url "$url"} --without-claude --guest-claude --lab "$tree" "$dir" >/dev/null
    start_watch
    "$tree/scripts/fresh.sh" link ;;
  link) "$tree/scripts/fresh.sh" link ;;
  status) "$tree/scripts/fresh.sh" status; watching && echo "watcher: running" || echo "watcher: stopped" ;;
  logs) exec tail -n 50 -f "$dir/watch.log" ;;
  stop)
    watching && kill "$(cat "$dir/watch.pid")" && rm -f "$dir/watch.pid"
    "$tree/scripts/fresh.sh" down ;;
  *) sed -n 2,14p "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
