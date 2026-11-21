#!/usr/bin/env bash
# Installs the public guard in this clone: a pre-push hook that checks every push to the public repository
# (scripts/hooks/pre-push, scripts/check-public.mjs). The hook and the check are copied into the clone's .git/hooks,
# which all its worktrees share, so a worktree on an older branch is guarded too. Run it again after the guard
# changes. It also gives this clone a GitHub noreply commit e-mail when gh knows your account (your own address
# never belongs in a public commit). Usage: scripts/install-hooks.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
hooks=$(cd "$(git -C "$here" rev-parse --git-common-dir)" && pwd)/hooks
mkdir -p "$hooks/weevils-public"
if [ -f "$hooks/pre-push" ] && ! grep -q 'weevils \(public\|history\) guard' "$hooks/pre-push"; then
  cp "$hooks/pre-push" "$hooks/pre-push.before-weevils-guard"
  echo "kept your own pre-push hook as $hooks/pre-push.before-weevils-guard (it no longer runs)"
fi
cp "$here/check-public.mjs" "$here/public-guard.json" "$hooks/weevils-public/"
cp "$here/hooks/pre-push" "$hooks/pre-push"
chmod +x "$hooks/pre-push"
echo "public guard installed in $hooks"
mail=$(git -C "$here" config user.email || true)
case $mail in
  *@users.noreply.github.com) ;;
  *)
    if command -v gh >/dev/null 2>&1 && id=$(gh api user -q '"\(.id)+\(.login)@users.noreply.github.com"' 2>/dev/null) && [ -n "$id" ]; then
      git -C "$here" config user.email "$id"
      echo "this clone now commits as $id"
    else
      echo "set a GitHub noreply commit e-mail for this clone: git config user.email <id>+<login>@users.noreply.github.com"
    fi ;;
esac
command -v gitleaks >/dev/null 2>&1 || echo "gitleaks is not installed: the hook will not look for secrets (https://github.com/gitleaks/gitleaks)"
marks=${XDG_CONFIG_HOME:-$HOME/.config}/weevils/public-guard.txt
[ -f "$marks" ] || echo "your own markers (names, domains, projects that must never be published) go in $marks, one regular expression per line"
