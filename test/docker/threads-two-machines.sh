#!/usr/bin/env bash
# Threads (WEEVILS_THREADS, docs/spec step 4) across two machines, with a failure: a server (the hub, the dispatcher)
# and a laptop, each running test/docker/threads-machine.ts (the real writer, hub sync, Threads service and start.ts,
# with a fake engine). Ends with PASS or FAIL.
#
#   test/docker/threads-two-machines.sh          two Docker containers on one network; the laptop reaches the hub
#                                                over SSH, the server reaches the laptop over HTTP
#   LOCAL=1 test/docker/threads-two-machines.sh  the same two machines as two local processes (no Docker, no SSH)
#
# The story: a message sent to the server is placed on the laptop (more room); the laptop's engine takes one step and
# the laptop is killed (SIGKILL) mid-turn. The server must steal the lease within 130 s of the last renewal, place the
# turn on itself (rule `machine`, rung 2: the session rebuilt from the hub, the preface) and finish it, with one user
# message, a valid journal and nothing signed in the conversation. Then the laptop comes back and stops writing to the
# thread (an orphan, if any, becomes a late note). It commits nothing; KEEP=1 keeps the containers.
#
# Before all that, the activation: the server already has an old Claude Code session whose last request stopped on a
# provider error ten days ago (what step 1 recorded on a real install). Switching threads on must never send it to an
# engine, place it or hold it.
set -uo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
work=$(mktemp -d)
tag=$$
fails=0
pids=()
containers=()
net=""
cleanup() {
  for p in "${pids[@]}"; do kill -9 "$p" 2>/dev/null; done
  if [ "${KEEP:-0}" != 1 ]; then
    for c in "${containers[@]}"; do docker rm -f "$c" >/dev/null 2>&1; done
    [ -n "$net" ] && docker network rm "$net" >/dev/null 2>&1
    rm -rf "$work"
  else echo "kept: $work ${containers[*]:-}"; fi
}
trap cleanup EXIT
say() { printf '\n\e[30;43m %s \e[0m\n' "$*"; }
ok() { printf '  \e[32mok\e[0m   %s\n' "$1"; }
bad() { printf '  \e[31mFAIL\e[0m %s\n' "$1"; fails=$((fails + 1)); }

# An old Claude Code session on the server, ten days ago: a request, then the provider's error (the turn failed, api).
OLD=0a1d0000-0000-4000-8000-000000000001
old_session() { # old_session <home> <cwd>: the lines, in that home's ~/.claude/projects
  local dir="$1/.claude/projects/$(printf '%s' "$2" | sed 's/[^A-Za-z0-9]/-/g')" t
  t=$(date -u -d '10 days ago' +%Y-%m-%dT%H:%M)
  local base="\"isSidechain\":false,\"userType\":\"external\",\"cwd\":\"$2\",\"sessionId\":\"$OLD\",\"version\":\"2.1.4\",\"gitBranch\":\"main\""
  printf 'mkdir -p %q && cat >%q <<EOF\n%s\n%s\nEOF\n' "$dir" "$dir/$OLD.jsonl" \
    "{\"parentUuid\":null,$base,\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"Rename the export button\"},\"uuid\":\"0a1d0000-0000-4000-8000-0000000000a1\",\"timestamp\":\"$t:00.000Z\"}" \
    "{\"parentUuid\":\"0a1d0000-0000-4000-8000-0000000000a1\",$base,\"type\":\"assistant\",\"message\":{\"id\":\"msg_old\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"<synthetic>\",\"content\":[{\"type\":\"text\",\"text\":\"API Error: 500 Internal server error\"}]},\"isApiErrorMessage\":true,\"error\":\"server_error\",\"uuid\":\"0a1d0000-0000-4000-8000-0000000000a2\",\"timestamp\":\"$t:05.000Z\"}"
}

# ---------------------------------------------------------------- the two machines, local or in Docker
if [ "${LOCAL:-0}" = 1 ]; then
  S=http://127.0.0.1:4191
  L=http://127.0.0.1:4192
  hub="$work/server/.local/share/weevils/hub.git"
  seed() { # seed <home> <account>
    mkdir -p "$1/projects" && git clone -q "$work/origin/shop.git" "$1/projects/shop"
    printf '{"oauthAccount":{"accountUuid":"%s"}}\n' "$2" >"$1/.claude.json"
  }
  git -c init.defaultBranch=main init -q "$work/seed" && mkdir -p "$work/seed/src" && echo 'export const fmt = (n: number) => `${n}`' >"$work/seed/src/money.ts"
  git -C "$work/seed" add -A && git -C "$work/seed" -c user.name=user -c user.email=user@example.com commit -qm first
  git clone -q --bare "$work/seed" "$work/origin/shop.git"
  seed "$work/server" account-of-server
  seed "$work/laptop" account-of-laptop
  bash -c "$(old_session "$work/server" "$work/server/projects/shop")"
  start_server() {
    (cd "$root" && HOME="$work/server" THREADS_MACHINE=server THREADS_ROLE=server THREADS_PORT=4191 THREADS_PEERS="laptop=$L" THREADS_QUOTA=60 FAKE_TURN_MS=1000 \
      exec node test/docker/threads-machine.ts serve >>"$work/server.log" 2>&1) &
    pids+=($!)
  }
  start_laptop() {
    (cd "$root" && HOME="$work/laptop" THREADS_MACHINE=laptop THREADS_ROLE=laptop THREADS_PORT=4192 THREADS_HUB="$hub" THREADS_QUOTA=10 FAKE_TURN_MS=600000 \
      exec node test/docker/threads-machine.ts serve >>"$work/laptop.log" 2>&1) &
    laptop_pid=$!
    pids+=($laptop_pid)
  }
  kill_laptop() { kill -9 "$laptop_pid" 2>/dev/null; wait "$laptop_pid" 2>/dev/null; }
  report() { (cd "$root" && node test/docker/threads-machine.ts report "$1" "$hub"); }
  logs() { tail -n 40 "$work/server.log" "$work/laptop.log"; }
  server_log() { cat "$work/server.log"; }
else
  command -v docker >/dev/null || { echo "docker is not installed (LOCAL=1 runs the same story without it)"; exit 2; }
  image=weevils-threads-test
  net=weevils-threads-$tag
  S=http://127.0.0.1:4191
  say "image (node 24, git, ssh) and network"
  docker build -q -t "$image" - >/dev/null <<'DOCKERFILE' || { echo "docker build failed"; exit 1; }
FROM node:24-bookworm
RUN apt-get update -qq && apt-get install -y -qq git openssh-server openssh-client >/dev/null && mkdir -p /run/sshd \
 && useradd -m -s /bin/bash user && git config --system user.name user && git config --system user.email user@example.com \
 && git config --system init.defaultBranch main
DOCKERFILE
  docker network create "$net" >/dev/null
  # The code of this checkout (HEAD and what is not committed), with its node_modules installed once in the image run.
  tar -C "$root" --exclude=node_modules --exclude=.git -czf "$work/code.tgz" .
  for m in server laptop; do
    c=weevils-threads-$m-$tag
    containers+=("$c")
    ports=()
    [ "$m" = server ] && ports=(-p 127.0.0.1:4191:4191)
    docker run -d --name "$c" --hostname "$m" --network "$net" --network-alias "$m" "${ports[@]}" "$image" sleep infinity >/dev/null
    docker cp "$work/code.tgz" "$c:/tmp/code.tgz"
    docker exec "$c" bash -c 'mkdir -p /opt/weevils && tar -C /opt/weevils -xzf /tmp/code.tgz && cd /opt/weevils && npm ci --no-audit --no-fund --loglevel=error >/dev/null' || { echo "npm ci failed on $m"; exit 1; }
  done
  SC=weevils-threads-server-$tag
  LC=weevils-threads-laptop-$tag
  as() { local c=$1; shift; docker exec -u user -e HOME=/home/user "$c" bash -c "$*"; }
  # The project's origin on the server; both machines clone it (the laptop over SSH); the laptop's key on the server.
  as "$SC" 'mkdir -p ~/seed/src ~/origin ~/projects && cd ~/seed && git init -q && echo "export const fmt = (n: number) => \`\${n}\`" >src/money.ts && git add -A && git commit -qm first && git clone -q --bare ~/seed ~/origin/shop.git && git clone -q ~/origin/shop.git ~/projects/shop && echo "{\"oauthAccount\":{\"accountUuid\":\"account-of-server\"}}" >~/.claude.json'
  docker exec "$SC" /usr/sbin/sshd
  as "$LC" 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/id_ed25519 && echo "{\"oauthAccount\":{\"accountUuid\":\"account-of-laptop\"}}" >~/.claude.json'
  docker exec "$LC" cat /home/user/.ssh/id_ed25519.pub | docker exec -i -u user "$SC" bash -c 'mkdir -p ~/.ssh && cat >>~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys'
  SSH='ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes'
  as "$LC" "mkdir -p ~/projects && GIT_SSH_COMMAND='$SSH' git clone -q user@server:origin/shop.git ~/projects/shop" || { echo "the laptop cannot reach the server over SSH"; exit 1; }
  hub=/home/user/.local/share/weevils/hub.git
  as "$SC" "$(old_session /home/user /home/user/projects/shop)"
  start_server() {
    docker exec -d -u user -e HOME=/home/user -e THREADS_MACHINE=server -e THREADS_ROLE=server -e THREADS_PORT=4191 -e THREADS_PEERS=laptop=http://laptop:4192 -e THREADS_QUOTA=60 -e FAKE_TURN_MS=1000 \
      -w /opt/weevils "$SC" bash -c 'node test/docker/threads-machine.ts serve >>/tmp/threads.log 2>&1'
  }
  start_laptop() {
    docker start "$LC" >/dev/null 2>&1
    docker exec -d -u user -e HOME=/home/user -e THREADS_MACHINE=laptop -e THREADS_ROLE=laptop -e THREADS_PORT=4192 -e "THREADS_HUB=user@server:$hub" -e "THREADS_SSH=$SSH" -e THREADS_QUOTA=10 -e FAKE_TURN_MS=600000 \
      -w /opt/weevils "$LC" bash -c 'node test/docker/threads-machine.ts serve >>/tmp/threads.log 2>&1'
  }
  kill_laptop() { docker kill -s KILL "$LC" >/dev/null; }
  report() { docker exec -u user -w /opt/weevils "$SC" node test/docker/threads-machine.ts report "$1" "$hub"; }
  logs() { docker exec "$SC" tail -n 40 /tmp/threads.log; docker exec "$LC" tail -n 40 /tmp/threads.log 2>/dev/null; }
  server_log() { docker exec "$SC" cat /tmp/threads.log; }
fi

json() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const o=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }
wait_for() { # wait_for <seconds> <description> <command…>: true once the command succeeds
  local until=$((SECONDS + $1)) what=$2; shift 2
  while [ $SECONDS -lt $until ]; do "$@" >/dev/null 2>&1 && return 0; sleep 2; done
  echo "  timed out: $what"; return 1
}

# ---------------------------------------------------------------- the story
say "both machines up"
start_server
start_laptop
wait_for 60 "server up" curl -sf "$S/health" && ok "server answers"
sleep 15 # both engines.json written and read (every 10 s)
# The thread the shadow writer made of the old session (titled with its request).
old_thread() { curl -sf "$S/threads" | json 'o.threads.find(t => /export button/.test(t.title))?.thread ?? ""'; }
has_old() { [ -n "$(old_thread)" ]; }
wait_for 30 "the old session recorded" has_old && ok "the old session is a thread ($(old_thread))" || { bad "the old session was never recorded"; logs; exit 1; }
sleep 10 # a few dispatcher rounds over the old session's thread
if server_log | grep -q "engine \(open\|resume\) ${OLD:0:8}"; then bad "the old session was sent to an engine"; else ok "the old session was not sent to an engine"; fi
if server_log | grep -qE '\[threads\] [0-9A-Z]{6} turn [0-9]+\.[0-9]+: '; then bad "the dispatcher decided on a turn from before"; server_log | grep -E '\[threads\] [0-9A-Z]{6} turn [0-9]+\.[0-9]+: ' | head -3; else ok "no turn from before was placed or held"; fi
[ "$(curl -sf "$S/view/$(old_thread)" | json 'JSON.stringify([o.state, o.hold?.reason ?? null])')" = '["waiting","stopped"]' ] && ok "the app shows it stopped, the person's move" || bad "the old thread's state: $(curl -sf "$S/view/$(old_thread)" | json 'JSON.stringify([o.state, o.hold])')"

say "a message, placed on the laptop (more room)"
id=$(curl -sf -X POST "$S/send" -H 'content-type: application/json' -d '{"text":"Show prices with the currency","project":"shop"}' | json 'o.thread')
[ -n "$id" ] && ok "thread $id" || { bad "no thread"; logs; exit 1; }
on_laptop() { report "$id" | json 'o.lease && o.lease.holder === "laptop" && o.lease.state === "working" && o.turns.some(t => t[1] === "running") ? 0 : 1' | grep -qx 0; }
wait_for 90 "the laptop runs the turn" on_laptop && ok "the laptop holds the lease, working" || { bad "the turn never ran on the laptop"; logs; exit 1; }
sleep 25 # one renewal pushes the step the engine took

say "the laptop dies mid-turn"
kill_laptop
t0=$SECONDS
done_on_server() { report "$id" | json 'o.turns.at(-1)[1] === "done" && o.legs.some(l => l[1].endsWith("@server")) ? 0 : 1' | grep -qx 0; }
if wait_for 300 "the turn finished on the server" done_on_server; then ok "the server finished the turn, $((SECONDS - t0)) s after the kill"; else bad "the turn did not move"; logs; fi
r=$(report "$id")
echo "  $r"
[ "$(echo "$r" | json 'o.invalid.length')" = 0 ] && ok "the journal is valid" || bad "the journal breaks an invariant"
[ "$(echo "$r" | json 'JSON.stringify(o.userMessages)')" = '["Show prices with the currency"]' ] && ok "one user message" || bad "the user message is not there exactly once"
[ "$(echo "$r" | json 'o.signed')" = 0 ] && ok "nothing signed in the conversation" || bad "the preface shows as a message"
[ "$(echo "$r" | json 'o.turns.filter(t => t[1] === "failed").map(t => t[2]).join()')" = machine-lost ] && ok "one failure, machine-lost" || bad "unexpected failures"
[ "$(echo "$r" | json 'o.turns.filter(t => t[1] === "assigned").map(t => t[2]).join()')" = new,machine ] && ok "placed new, then machine" || bad "unexpected placements"
[ "$(curl -sf "$S/view/$id" | json 'o.state')" = waiting ] && ok "the app's state: your move" || bad "the app's state is not « your move »"

decided=$(server_log | grep -cE '\[threads\] [0-9A-Z]{6} turn [0-9]+\.[0-9]+: ' | tr -d ' ')
[ "$(server_log | grep -E '\[threads\] [0-9A-Z]{6} turn [0-9]+\.[0-9]+: ' | grep -vc "${id: -6} turn")" = 0 ] && ok "every decision was about the new thread ($decided)" || bad "a decision about another thread"
if server_log | grep -q "engine \(open\|resume\) ${OLD:0:8}"; then bad "the old session was sent to an engine"; fi

say "the laptop comes back"
start_laptop
settled() { report "$id" | json 'o.orphans.length === 0 && o.lease.holder === "server" && o.invalid.length === 0 ? 0 : 1' | grep -qx 0; }
if wait_for 120 "orphans settled" settled; then ok "no orphan left; the server holds the thread"; else bad "the laptop's return left the thread unsettled"; logs; fi
echo "  $(report "$id")"

echo
if [ $fails = 0 ]; then printf '\e[32mPASS\e[0m threads across two machines\n'; else printf '\e[31mFAIL\e[0m %s check(s)\n' "$fails"; exit 1; fi
