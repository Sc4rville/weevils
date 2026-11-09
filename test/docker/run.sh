#!/usr/bin/env bash
# Tests install.sh for real, in blank Docker containers (ubuntu:24.04). One command, ends with PASS or FAIL.
#
#   test/docker/run.sh            all scenarios
#   test/docker/run.sh systemd    VPS with systemd: install from a clone, service + linger, login over http,
#                                 idempotent re-run, --domain with Caddy, survives a reboot
#   test/docker/run.sh plain      container without systemd: curl | bash style (piped), background fallback, re-run
#
# It installs the HEAD commit of this repo (commit first). KEEP=1 keeps the containers for a look.
set -uo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
which=${1:-all}
image=weevils-test-systemd
tag=$$
work=$(mktemp -d)
containers=()
networks=()
fails=0
passes=0

cleanup() {
  if [ "${KEEP:-0}" = 1 ]; then echo "kept: ${containers[*]:-}"; else
    for c in "${containers[@]}"; do docker rm -f "$c" >/dev/null 2>&1; done
    for n in "${networks[@]}"; do docker network rm "$n" >/dev/null 2>&1; done
    docker image rm "$image" >/dev/null 2>&1
  fi
  rm -rf "$work"
}
trap cleanup EXIT

say() { printf '\n\e[30;43m %s \e[0m\n' "$*"; }
check() { # check "description" command… (runs on the host; use inside/as_test for the container)
  local d=$1; shift
  if "$@" >"$work/out" 2>&1; then passes=$((passes + 1)); printf '  \e[32mok\e[0m   %s\n' "$d"
  else fails=$((fails + 1)); printf '  \e[31mFAIL\e[0m %s\n' "$d"; sed 's/^/       /' "$work/out" | tail -15; fi
}

# A fresh clone of HEAD, as a bare repo (the "GitHub" of the container) and a working clone of it.
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD)
git clone -q --bare --branch "$branch" "$root" "$work/weevils.git"
git -C "$work/weevils.git" symbolic-ref HEAD "refs/heads/$branch"
git clone -q "$work/weevils.git" "$work/weevils"
git -C "$work/weevils" remote set-url origin /srv/weevils.git
echo "testing $(git -C "$work/weevils" log -1 --format='%h %s')"

# ---------------------------------------------------------------- systemd
run_systemd() {
  say "systemd: blank Ubuntu 24.04 VPS, regular user with sudo"
  heavy docker build -q -t "$image" -f "$root/test/docker/systemd.Dockerfile" "$root/test/docker" >/dev/null || { fails=$((fails + 1)); echo "  FAIL docker build"; return; }
  local c=weevils-test-sd-$tag
  containers+=("$c")
  docker run -d --name "$c" --hostname testbox --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock "$image" >/dev/null
  docker exec "$c" systemctl is-system-running --wait >/dev/null 2>&1
  docker cp "$work/weevils.git" "$c:/srv/weevils.git"
  docker cp "$work/weevils" "$c:/home/test/weevils"
  docker exec "$c" chown -R test:test /srv/weevils.git /home/test/weevils
  as_test() { docker exec -u test -w /home/test -e XDG_RUNTIME_DIR=/run/user/1000 "$c" bash -c "$1"; }

  check "blank: no node, git, curl, tmux" as_test '! command -v node && ! command -v git && ! command -v curl && ! command -v tmux'
  echo "  \$ cd weevils && ./install.sh --yes --name Test --lang en"
  if ! as_test 'cd weevils && ./install.sh --yes --name Test --lang en' >"$work/install1.log" 2>&1; then
    fails=$((fails + 1)); echo "  FAIL install.sh exited non-zero"; tail -30 "$work/install1.log"; return
  fi
  sed 's/^/  │ /' "$work/install1.log"
  check "node >= 22.18 installed by the script" as_test 'node -p "process.versions.node" && node -e "const [a,b]=process.versions.node.split(\".\").map(Number); process.exit(a>22||(a==22&&b>=18)?0:1)"'
  check "tmux, jq, git, python3 installed" as_test 'command -v tmux && command -v jq && command -v git && command -v python3'
  check "linger enabled" as_test '[ "$(loginctl show-user test -p Linger --value)" = yes ]'
  check "weevilsd active under systemd --user" as_test 'systemctl --user is-active weevilsd && systemctl --user is-enabled weevilsd'
  check "GET /api/me answers" as_test 'curl -sf http://127.0.0.1:4179/api/me | grep -q "\"authed\":true"'
  check "the app HTML is served" as_test 'curl -sf http://127.0.0.1:4179/ | grep -qi "<div id=\"root\""'
  check "config generated (name, lang, machine)" as_test 'grep -qx WEEVILS_USER_NAME=Test ~/.config/weevils/env && grep -qx WEEVILS_LANG=en ~/.config/weevils/env && grep -qx WEEVILS_MACHINE=testbox ~/.config/weevils/env && grep -qx WEEVILS_ORCHESTRATOR=1 ~/.config/weevils/env'
  check "commands installed: wv, weevils, weevils-service, hook" as_test 'test -x ~/.local/bin/wv && test -x ~/.local/bin/weevils && test -x ~/.local/bin/weevils-service && test -x ~/.local/bin/weevils-hook'
  check "Claude Code hooks registered" as_test '[ "$(jq "[.hooks[][].hooks[].command | select(endswith(\"weevils-hook\"))] | length" ~/.claude/settings.json)" = 6 ]'
  check "end screen shows the login link" grep -q "localhost:4179/#k=" "$work/install1.log"
  # Login from "outside" (x-forwarded-for: not a local request), over plain http.
  check "login with the code works over http, cookie without Secure" as_test '
    code=$(cat ~/.config/weevils/secret)
    curl -s -D /tmp/h -o /tmp/b -H "x-forwarded-for: 203.0.113.9" -H "content-type: application/json" -d "{\"secret\":\"$code\"}" http://127.0.0.1:4179/api/login
    grep -qi "^set-cookie: wv=" /tmp/h && ! grep -i "^set-cookie" /tmp/h | grep -qi secure
    tok=$(sed -n "s/^[Ss]et-[Cc]ookie: wv=\([^;]*\).*/\1/p" /tmp/h)
    curl -sf -H "x-forwarded-for: 203.0.113.9" -H "cookie: wv=$tok" http://127.0.0.1:4179/api/me | grep -q "\"authed\":true"'
  check "no cookie from outside → not logged in, wrong code → 401" as_test '
    curl -sf -H "x-forwarded-for: 203.0.113.9" http://127.0.0.1:4179/api/me | grep -q "\"authed\":false"
    [ "$(curl -s -o /dev/null -w "%{http_code}" -H "x-forwarded-for: 203.0.113.9" -H "content-type: application/json" -d "{\"secret\":\"nope\"}" http://127.0.0.1:4179/api/login)" = 401 ]'

  say "systemd: re-run = update, idempotent"
  as_test 'sha256sum ~/.config/weevils/env ~/.config/weevils/secret ~/.claude/settings.json ~/.config/systemd/user/weevilsd.service' >"$work/sum1"
  check "second run exits 0" as_test 'cd weevils && ./install.sh --yes --name Test --lang en'
  cp "$work/out" "$work/install2.log"
  as_test 'sha256sum ~/.config/weevils/env ~/.config/weevils/secret ~/.claude/settings.json ~/.config/systemd/user/weevilsd.service' >"$work/sum2"
  check "config, code, hooks and unit unchanged" diff "$work/sum1" "$work/sum2"
  check "no rebuild when nothing changed" grep -q "already built" "$work/install2.log"
  check "still active, one weevilsd" as_test 'systemctl --user is-active weevilsd && [ "$(systemctl --user show weevilsd -p NMainPID --value 2>/dev/null || echo 1)" != 0 ] && curl -sf http://127.0.0.1:4179/api/me'

  say "systemd: --domain with Caddy (tls internal for the test)"
  if as_test 'cd weevils && WEEVILS_CADDY_TLS=internal ./install.sh --yes --domain weevils.test' >"$work/install3.log" 2>&1; then
    passes=$((passes + 1)); echo "  ok   install.sh --domain weevils.test"
    sed -n '/HTTPS/,/waiting/p' "$work/install3.log" | sed 's/^/  │ /'
  else fails=$((fails + 1)); echo "  FAIL install.sh --domain"; tail -20 "$work/install3.log"; fi
  check "caddy active, Caddyfile imports the weevils site" as_test 'systemctl is-active caddy && grep -q "import /etc/caddy/weevils.caddy" /etc/caddy/Caddyfile && grep -q "reverse_proxy 127.0.0.1:4179" /etc/caddy/weevils.caddy'
  check "HTTPS answers through Caddy (not a local request)" as_test 'for i in $(seq 20); do curl -sk --resolve weevils.test:443:127.0.0.1 https://weevils.test/api/me | grep -q "\"authed\":false" && exit 0; sleep 1; done; exit 1'
  check "login over HTTPS sets a Secure cookie" as_test '
    code=$(cat ~/.config/weevils/secret)
    curl -sk -D /tmp/h3 -o /dev/null --resolve weevils.test:443:127.0.0.1 -H "content-type: application/json" -d "{\"secret\":\"$code\"}" https://weevils.test/api/login
    grep -i "^set-cookie: wv=" /tmp/h3 | grep -qi secure'
  check "WEEVILS_PUBLIC_URL set from --domain, name kept" as_test 'grep -qx WEEVILS_PUBLIC_URL=https://weevils.test ~/.config/weevils/env && grep -qx WEEVILS_USER_NAME=Test ~/.config/weevils/env'
  check "end screen shows the https link" grep -q "https://weevils.test/#k=" "$work/install3.log"

  say "systemd: a second machine (--secondary), federated by the first through a reverse SSH tunnel"
  local c2=weevils-test-sd2-$tag net=weevils-test-net-$tag
  containers+=("$c2")
  networks+=("$net")
  docker network create "$net" >/dev/null
  docker network connect --alias mainbox "$net" "$c"
  docker run -d --name "$c2" --hostname laptop --network "$net" --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock "$image" >/dev/null
  docker exec "$c2" systemctl is-system-running --wait >/dev/null 2>&1
  # Test harness only: sshd on the main machine and a key for the second one (what "ssh-copy-id" would do).
  docker exec "$c" bash -c 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server >/dev/null 2>&1 && systemctl start ssh'
  ssh-keygen -q -t ed25519 -N '' -f "$work/key"
  docker exec "$c" bash -c 'mkdir -p /home/test/.ssh && chmod 700 /home/test/.ssh'
  docker cp "$work/key.pub" "$c:/home/test/.ssh/authorized_keys"
  docker exec "$c" chown -R test:test /home/test/.ssh
  docker exec "$c2" bash -c 'mkdir -p /home/test/.ssh'
  docker cp "$work/key" "$c2:/home/test/.ssh/id_ed25519"
  docker cp "$work/weevils.git" "$c2:/srv/weevils.git"
  docker cp "$work/weevils" "$c2:/home/test/weevils"
  docker exec "$c2" bash -c 'chmod 700 /home/test/.ssh && chmod 600 /home/test/.ssh/id_ed25519 && chown -R test:test /home/test/.ssh /srv/weevils.git /home/test/weevils'
  as_2() { docker exec -u test -w /home/test -e XDG_RUNTIME_DIR=/run/user/1000 "$c2" bash -c "$1"; }
  echo "  \$ cd weevils && ./install.sh --yes --name Test --secondary mainbox"
  if as_2 'cd weevils && ./install.sh --yes --name Test --secondary mainbox' >"$work/install4.log" 2>&1; then
    passes=$((passes + 1)); echo "  ok   install.sh --secondary mainbox"; sed 's/^/  │ /' "$work/install4.log"
  else fails=$((fails + 1)); echo "  FAIL install.sh --secondary"; tail -30 "$work/install4.log"; fi
  check "secondary: weevilsd and tunnel active, no weevboss, no app build" as_2 'systemctl --user is-active weevilsd weevils-tunnel && grep -qx WEEVILS_ORCHESTRATOR=0 ~/.config/weevils/env && grep -qx WEEVILS_MACHINE=laptop ~/.config/weevils/env && test ! -e weevils/dist/index.html'
  check "main: WEEVILS_REMOTES registered by the secondary" as_test 'grep -qx "WEEVILS_REMOTES=laptop=http://127.0.0.1:4192" ~/.config/weevils/env'
  check "main: the second machine is online in its snapshot" as_test 'for i in $(seq 30); do curl -sf http://127.0.0.1:4179/api/snapshot | jq -e ".machines[] | select(.id==\"laptop\" and .online==true)" && exit 0; sleep 1; done; exit 1'
  check "secondary re-run is idempotent (same tunnel port)" as_2 'cd weevils && ./install.sh --yes --secondary mainbox >/dev/null && grep -q "WEEVILS_TUNNEL_PORT=4192" ~/.config/weevils/service.conf'
  check "main: still a single remote entry" as_test '[ "$(grep -c "^WEEVILS_REMOTES=" ~/.config/weevils/env)" = 1 ] && grep -qx "WEEVILS_REMOTES=laptop=http://127.0.0.1:4192" ~/.config/weevils/env'

  say "systemd: reboot"
  docker restart "$c" >/dev/null
  docker exec "$c" systemctl is-system-running --wait >/dev/null 2>&1
  check "weevilsd back after reboot, without login (linger)" as_test 'for i in $(seq 30); do curl -sf http://127.0.0.1:4179/api/me && exit 0; sleep 1; done; exit 1'
}

# ---------------------------------------------------------------- plain (no systemd)
run_plain() {
  say "plain: container without systemd, root, curl | bash style"
  local c=weevils-test-plain-$tag
  containers+=("$c")
  docker run -d --name "$c" --hostname plainbox ubuntu:24.04 sleep infinity >/dev/null
  docker cp "$work/weevils.git" "$c:/srv/weevils.git"
  docker exec "$c" chown -R root:root /srv/weevils.git
  in_c() { docker exec -w /root "$c" bash -c "$1"; }
  echo "  \$ bash -s -- --yes --name Test --lang fr < install.sh     (WEEVILS_REPO=/srv/weevils.git: the repo is private)"
  if ! docker exec -i -w /root -e WEEVILS_REPO=/srv/weevils.git "$c" bash -s -- --yes --name Test --lang fr <"$work/weevils/install.sh" >"$work/plain1.log" 2>&1; then
    fails=$((fails + 1)); echo "  FAIL piped install exited non-zero"; tail -30 "$work/plain1.log"; return
  fi
  sed 's/^/  │ /' "$work/plain1.log"
  check "cloned into ~/weevils" in_c 'test -f ~/weevils/server/index.ts && git -C ~/weevils log -1 --oneline'
  check "background mode, weevilsd running" in_c '~/.local/bin/weevils-service status | grep -q "weevilsd: running"'
  check "GET /api/me answers, app served" in_c 'curl -sf http://127.0.0.1:4179/api/me && curl -sf http://127.0.0.1:4179/ | grep -qi "<div id=\"root\""'
  check "messages in French" grep -q "weevils est prêt" "$work/plain1.log"
  check "the fallback is explained" grep -q "weevils-service start|stop|status|logs" "$work/plain1.log"
  count() { docker exec "$c" bash -c 'n=0; for f in /proc/[0-9]*/cmdline; do tr "\0" " " <"$f" 2>/dev/null | grep -q "^[^ ]*node server/index.ts" && n=$((n+1)); done; echo $n'; }
  check "re-run (piped again) exits 0" docker exec -i -w /root -e WEEVILS_REPO=/srv/weevils.git "$c" bash -s -- --yes --lang fr <"$work/weevils/install.sh"
  check "still one weevilsd process" test "$(count)" = 1
  check "stop / start" in_c '~/.local/bin/weevils-service stop && ! curl -sf -m 2 http://127.0.0.1:4179/api/me; ~/.local/bin/weevils-service start && for i in $(seq 20); do curl -sf http://127.0.0.1:4179/api/me && exit 0; sleep 0.5; done; exit 1'
}

case "$which" in
  systemd) run_systemd ;;
  plain) run_plain ;;
  all) run_systemd; run_plain ;;
  *) echo "usage: $0 [all|systemd|plain]"; exit 2 ;;
esac

echo
if [ "$fails" = 0 ] && [ "$passes" -gt 0 ]; then printf '\e[30;42m PASS \e[0m %d checks\n' "$passes"; exit 0
else printf '\e[97;41m FAIL \e[0m %d failed, %d passed\n' "$fails" "$passes"; exit 1; fi
