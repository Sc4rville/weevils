#!/usr/bin/env bash
# Every day (the weevils-get-backup timer): get's install register and its records, copied into a private repository
# of whoever runs this service (GET_STATS_REPO, in ~/.config/weevils-get/env), so that the trace outlives this
# machine. GET_STATS_BRANCH (optional) keeps it on its own branch of a repository that holds something else, such as
# the product's private repository, so no extra repository is needed. Anonymous data only: no address, no e-mail, no identifier. The daily counters stay on this machine (kept
# 90 days). Usage: get/backup-stats.sh [<data dir>]
set -euo pipefail
data=${1:-${GET_DATA:-$HOME/.local/share/weevils-get}}
repo=${GET_STATS_REPO:-}
branch=${GET_STATS_BRANCH:-}
clone=$data/backup
if [ ! -d "$clone/.git" ]; then
  [ -n "$repo" ] || { echo "backup-stats: set GET_STATS_REPO to a private repository of yours" >&2; exit 1; }
  if [ -n "$branch" ]; then
    # Its own branch: cloned alone, or started empty the first time (never the repository's other history).
    if git ls-remote --exit-code --heads "$repo" "$branch" >/dev/null 2>&1; then git clone -q --single-branch -b "$branch" "$repo" "$clone"
    else git init -q -b "$branch" "$clone" && git -C "$clone" remote add origin "$repo"; fi
  else git clone -q "$repo" "$clone"; fi
fi
git -C "$clone" pull -q --ff-only 2>/dev/null || true
for f in installs.csv records.json; do [ ! -f "$data/$f" ] || cp "$data/$f" "$clone/$f"; done
cd "$clone"
git add -A
git diff --cached --quiet && exit 0
GIT_AUTHOR_NAME=weevils GIT_AUTHOR_EMAIL=weevils@users.noreply.github.com GIT_COMMITTER_NAME=weevils GIT_COMMITTER_EMAIL=weevils@users.noreply.github.com \
  git commit -q -m "stats $(date -u +%F)"
git push -q -u origin HEAD
echo "backed up: $(($(wc -l <installs.csv 2>/dev/null || echo 1) - 1)) installs"
