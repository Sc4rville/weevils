# Session controls and evidence

This is a product contract shared by Claude and Codex. The FR/EN orchestrator templates ship the same rules to `CLAUDE.md` and `AGENTS.md`, including on a fresh installation. Personal memory may personalize a brief; it is not an implementation dependency for controls, delivery or activity display.

## Observable behavior

- A send acknowledgement means accepted for delivery, potentially queued. It does not prove that an agent has read the message or completed its turn. Preserve delivery identity on retry. Codex's existing native queue is used while a turn is active; sending does not interrupt that turn or start another conversation.
- Model and reasoning controls use the available model catalog, update the existing thread's future-turn settings and verify readback. A menu command is not sent as chat. An older recorded turn context describes that older turn, not necessarily the next-turn setting.
- Activity follows runtime samples and recorded turn transitions. A newer transition supersedes an older cached sample. A command's nonzero exit status is not evidence that the agent session died. Genuine questions/approvals alone warrant attention.
- Tool groups and individual steps begin collapsed. Opening a step reveals the recorded command and result, or an explicit absence. Commands and results are redacted before they cross the session API, truncated excerpts are marked, and strings are rendered as text rather than HTML.
- The compact action combines a translated category with concrete executable/subcommand names when known. Literal descriptions and nested tool names remain inspectable. Do not replace every tool by another generic synonym for “exec”.
- Extracted wrapper arguments are evidence of the submitted program, not proof that every conditional branch ran. A wrapper's output belongs to its recorded call identifier; do not invent a separate outcome for each nested call. Dynamic arguments are unknown, never evaluated by the parser.
- Explicit app locale controls generated product text independently of chat language; proper names and identifiers remain intact. No automatic QA cards, raw commit announcements or diagnostic vocals belong in the user feed.

## Verification without personal state

`test/codex-recorded-wrapper.test.tsx` replays a real recorded orchestration call and its structured result through `TranscriptStore`, the serializable API message contract and the normal `Messages` component. It opens the group and the individual step and checks the literal command and result.

`server/relay-core.test.ts` creates the generated instructions in a temporary home. Both agents receive identical rules, the default profile has no personal name/domain, and a synthetic private-memory sentinel is not imported. No actual agent, model request, tmux session or render is started. This test does not import the separately prepared portable profile into a user's instance.

Parser, runtime, delivery and UI regressions also live in `server/codex-command-details.test.ts`, `server/codex-bridge.test.ts`, `server/lifecycle.test.ts`, `server/transcripts.test.ts`, `src/ui/model-controls.test.tsx` and `src/ui/session-reading.test.tsx`.
