#!/bin/sh
# Hook Claude Code → weevilsd (local). Ne bloque jamais la session : 1 s max, erreurs ignorées. PostToolUse, qui tombe
# après chaque appel d'outil, n'attend même pas : l'événement est lu, envoyé en arrière-plan (sorties fermées, pour que
# Claude Code n'attende pas non plus), et le hook rend la main tout de suite. Les autres événements (début, message,
# fin) partent dans l'ordre, avant que le hook ne rende la main.
# Installé par server/install.sh dans ~/.claude/settings.json (tous les événements utiles).
pid=$PPID
send() {
  curl -s -m 1 -X POST -H 'content-type: application/json' -H "x-pid: $pid" \
    --data-binary @- "http://127.0.0.1:${WEEVILS_HOOK_PORT:-4180}/hook" >/dev/null 2>&1 || true
}
body=$(cat)
case $body in
  *'"hook_event_name":"PostToolUse"'* | *'"hook_event_name": "PostToolUse"'*)
    { printf '%s' "$body" | send; } </dev/null >/dev/null 2>&1 &
    ;;
  *) printf '%s' "$body" | send ;;
esac
exit 0
