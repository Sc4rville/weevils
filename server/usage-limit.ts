// The words a provider uses when a usage limit stops it. One pattern for every reader: the transcript reader
// (stopErrorOf, server/transcripts.ts, which the weevbook's adapters reuse) and the one-shot model calls (fast.ts).
//
// Claude Code: "Claude AI usage limit reached|<epoch>", "5-hour limit reached ∙ resets 3pm", "Opus weekly limit
// reached", "You've hit your session limit · resets 4pm (UTC)", "You've hit your weekly limit · resets Nov 13, 4pm
// (UTC)", "You've hit your Opus limit", "Credit balance is too low", an API error with rate_limit_error.
// Codex: "You've hit your usage limit. Upgrade to Pro (…) or try again in 2 days", "Rate limit reached for …",
// "Quota exceeded".
export const USAGE_LIMIT = /usage.?limit|limit reached|rate.?limit|quota|out of [^.\n]*(?:usage|credits)|credit balance|hit your [^.\n]*limit|\b(?:session|weekly|daily|5-hour|opus|sonnet) limit\b/i
