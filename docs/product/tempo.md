# Tempo

How fast weevils takes requests, per repo, under one global ceiling. It replaces the speed-modes draft: the five
modes it named stay (Pause, Standby, Cruise, Turbo, Max) and two come above them (Fleet, Swarm).

Code: `shared/tempo.ts` (modes and constants), `server/tempo.ts` (the arithmetic, pure), `server/spend-ledger.ts`
(the measured history), `server/tempo-service.ts` (wiring, `GET/POST /api/tempo`), `src/ui/tempo.tsx` (the icon, the
band, the panel), `src/ui/tempo-icons.ts` (the icons, one map).

## The one rule

Every mode but Pause takes requests. A lower mode slows the pace (fewer agents, lighter models, a longer queue); it
never stops intake and never leaves a request waiting forever. Pause is the only state that stops new work.

The longest the oldest request of a repo waits, counted from the moment that repo has nothing running: Max and up
at once, Turbo at once, Cruise 1 hour, Standby 4 hours (`MAX_WAIT_MS`). The budget decides how fast and how strong,
never whether. The one exception is outside weevils: every Claude account and Codex at their real limit; the queue
starts again by itself the minute a window reopens. `server/tempo.test.ts` simulates a week in every mode with the
budget 40 points over its pace: all 20 requests start, oldest first, none past its limit; Pause starts none.

## The control

- A repo's Requests page has one icon at the top. A tap sets the next mode: only the icon changes, and a slim band
  slides in from the side: « At this rate weevils will use up to X tokens a day, at most Y % of your active
  intelligence and Z GB of your VPS », with how sure it is (« rough: 6 days of history »).
- Past the highest open mode, or on a long press, a wide panel drops from the top: a track with the 7 modes, the
  locked ones shown. A tap on a mode shows its card: agents at once, what it needs, one example, and for a locked
  mode what opens it (subscriptions, a machine, the host's next plan and price when weevils knows it).
- Settings has the global Tempo, same control. It is the ceiling: no repo goes above it (a repo set higher runs at
  the ceiling, and its band says « capped by your global Tempo »). A repo never set runs at Cruise, today's pace, or
  at the ceiling when that is lower. The ceiling starts at Max: only a repo turned up spends more than before.

## The modes

| Mode | Agents at once | Opens with (agent-hours a day the plans feed) | Over the week's pace |
|---|---|---|---|
| Pause | 0 | always | nothing starts |
| Standby | 1 | any plan | only the floor: one start per 4 h of a free repo, light tier |
| Cruise | 2 | any plan | from the line up: one agent, light tier, floor 1 h |
| Turbo | 4 | 8 | up to 10 points over: full pace; past it: one agent, light |
| Max | 6 | 15 (about one Max 20x) | full pace until the real limit |
| Fleet | 12 | 30 (about two) | idem |
| Swarm | 24 | 60 (about four) | idem |

A mode also needs the machine to carry its agents: by default half a core, 1 GB of memory and 1.5 GB of disk per
working agent, keeping 20 % of the cores, 15 % of the memory and 10 GB of disk free. A mode chosen and no longer
open (an account removed) runs as the highest open one.

Model tiers by mode: Standby light; Cruise and Turbo usual; Max and up strong; any mode slowed by the pace, light.

## The global ceiling, split fairly

The global mode's agents are shared between the active repos (a queue or something running): each wants its own
mode's agents (never above the global one), the ceiling is split equally, and what a repo does not use goes to the
others. A tie gives the extra agent to the repo listed first.

## The numbers: measured, never assumed

- **The spend ledger** (`DATA_DIR/spend-ledger.json`, on the machine only): per day, forever, the list-price dollars,
  tokens, answers and agent-hours per repo, model and tool; per session for 90 days; every subscription meter
  reading (Claude and Codex: plan, % of the week and of the 5-hour window, source, time) for 120 days. An agent-hour
  is a 5-minute slice in which a session answered. It is fed every 10 minutes from the transcripts
  (`server/spend.ts`), so it keeps days that Claude Code later deletes.
- **The plan's size** is learned from the provider's own meter: each week, the spend up to a reading over its
  percent (`spend-calibration.jsonl`, now written every 10 minutes, not only when the app is open). The value is
  the latest week, the range the last 4 weeks; « rough » until 3 weeks are measured.
- **The cost of an agent-hour** (dollars and tokens) is the median of the last 28 days; the range is the quartiles,
  at least ±30 % until 7 days are measured; with none, a labelled default ($13, 6 M tokens).
- **The machine**: cores, memory, free disk read from the machine; the host's plan and next plan from its own site
  (`server/discover.ts`, weekly).
- Each figure carries its source, its time and its confidence (`measured`, `rough`, `default`); the band says it.

## Starting work

Every minute the server reads each repo's queue from the request ledger (requests never sent, except those the
user said « later »; requests whose session was cut go back to the queue), applies the split and the pace, and
hands each due start to weevboss as an intake wake-up (`server/boss-wakeups.ts`): weevboss writes the brief and
sends it. Intake wake-ups run in every mode but Pause, without the triage pass and outside the daily cap of
follow-ups. A start is raised once, then again only if it is still waiting: after its mode's wait (an hour at least), doubled each time, at most once a day, so a request weevboss cannot start never costs a turn an hour.

## Rules kept from before

- The user's own words win: « now » sends at once, « later » waits for the user (`server/request-handling.ts`).
- Follow-ups (results, questions, cuts, the self-check) wake weevboss from Cruise up only; Standby takes starts only.
- The older readers still see one speed mode: the mode of weevboss's own queue (requests about no repo), Standby
  read as `veille`, Fleet and Swarm as `max`. Never set, that is Cruise, as before.
- `WEEVILS_SPEED_MODE` sets the global ceiling until it is first set in the app.

## Not yet

- Per-account spend: transcripts do not say which Claude account answered; the tank counts the signed-in accounts
  at the size measured on the main one.
- Codex counts for the hard limit (work can go on there) but not yet in the agent-hours a day.
- Model prices are the list prices written in `server/spend.ts`, not fetched.
- Paid services (RunPod) are not in the ledger yet.
- The machine's share per working agent is a default until weevils records which sessions were working each minute.
