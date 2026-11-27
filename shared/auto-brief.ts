// The brief weevils itself writes to start an automation's run (server/i18n/optimizers.ts `brief`): rules for the
// agent, a worktree, what the command may do. Plumbing: a thread shows one calm line in its place (src/ui/bits.tsx),
// the whole text one deliberate tap away. Only ever asked of a signed message, never of one the person wrote.

/** Its opening words and where the name sits, in the two languages the server writes it in. */
const OPENINGS: [RegExp, RegExp][] = [
  [/^Background task started by weevils\b/, /"(.+)"/],
  [/^Tâche de fond lancée par weevils\b/, /«(.+)»/],
]

/** The automation's name when `text` is such a brief ('' when the name cannot be read); null: any other message. */
export function autoBriefTitle(text: string): string | null {
  const first = text.trimStart().split('\n')[0] ?? ''
  for (const [opening, title] of OPENINGS) if (opening.test(first)) return title.exec(first)?.[1].trim() ?? ''
  return null
}

/** An automation that runs while the person sleeps: on the sleep trigger, or in a window that opens at night. */
export const nightTask = (o: { onSleep?: boolean; window?: { from: number; to: number } }) =>
  !!o.onSleep || (!!o.window && (o.window.from >= 21 * 60 || o.window.from < 6 * 60))
