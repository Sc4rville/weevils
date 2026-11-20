import { describe, expect, it } from 'vitest'
import { stopErrorOf } from './transcripts.ts'
import { USAGE_LIMIT } from './usage-limit.ts'

// The weevbook's adapters take a stop error's reason from stopErrorOf: the app and the journal read the same words.
describe('usage limits, in the words of both providers', () => {
  it('a usage limit stops the turn as quota', () => {
    const claude = [
      'Claude AI usage limit reached|1794200000',
      "You've hit your weekly limit · resets Nov 13, 4pm (UTC)",
      "You've hit your session limit · resets 4pm (Europe/Paris)",
      'You’ve hit your Opus limit · resets Nov 14, 9am (UTC)',
      "You've hit your limit · resets 5am (UTC)",
      '5-hour limit reached ∙ resets 3pm',
      'Session limit reached ∙ resets 8pm',
      'Opus weekly limit reached ∙ resets Nov 13, 4pm',
      'Weekly limit reached ∙ resets Mon 9am',
      'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}',
      'Credit balance is too low',
    ]
    const codex = [
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again in 2 days 3 hours 5 minutes.",
      'You have hit your usage limit.',
      'Rate limit reached for gpt-5 in organization org-x on tokens per min (TPM): Limit 30000, Used 29800.',
      'Quota exceeded. Check your plan and billing details.',
    ]
    for (const text of [...claude, ...codex]) {
      expect(USAGE_LIMIT.test(text), text).toBe(true)
      expect(stopErrorOf(0, undefined, text).reason, text).toBe('quota')
    }
    // Codex also says it in the error's kind.
    expect(stopErrorOf(0, 'usage_limit_exceeded', 'stream error').reason).toBe('quota')
  })

  it('other errors are not a usage limit', () => {
    for (const text of ['API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', 'stream disconnected before completion', 'Error during compaction: Conversation too long', 'Prompt is too long', 'API Error: 500 Internal server error', 'the input exceeds the context window limit of this model']) {
      expect(USAGE_LIMIT.test(text), text).toBe(false)
      expect(stopErrorOf(0, undefined, text).reason, text).toBe('api')
    }
    expect(stopErrorOf(0, undefined, 'OAuth token has expired. Please run /login').reason).toBe('auth')
  })
})
