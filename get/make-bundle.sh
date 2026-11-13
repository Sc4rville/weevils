#!/usr/bin/env bash
# While the weevils repository is private, get/server.mjs serves the code to the installs it starts (GET_BUNDLE).
# This builds that bundle: a single commit snapshot of a committed revision (no history, no author e-mail), without
# the paths that must not be redistributed. Usage: get/make-bundle.sh [<rev>] [<out>] [<checkout>]
# <checkout> is the clone to take <rev> from (default: the one this script is in). The bundle is what an install
# gets: for Mac visitors, <rev> must hold the installer that supports macOS.
set -euo pipefail
rev=${1:-HEAD}
out=${2:-$HOME/.local/share/weevils-get/weevils.bundle}
src=$(git -C "${3:-$(dirname "$0")/..}" rev-parse --show-toplevel)
commit=$(git -C "$src" rev-parse --verify "$rev^{commit}")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git -C "$src" archive "$commit" | tar -x -C "$work"
rm -rf "$work/harness-interface-kit" "$work/harness-interface-kit.zip" "$work/content" "$work/docs/incidents"
cd "$work"
git init -q -b main
git add -A
GIT_AUTHOR_NAME=weevils GIT_AUTHOR_EMAIL=weevils@users.noreply.github.com GIT_COMMITTER_NAME=weevils GIT_COMMITTER_EMAIL=weevils@users.noreply.github.com \
  git commit -q -m "weevils ${commit:0:7}"
mkdir -p "$(dirname "$out")"
git bundle create -q "$out.tmp" HEAD main
mv -f "$out.tmp" "$out"
echo "$out (${commit:0:7}, $(du -h "$out" | cut -f1))"
