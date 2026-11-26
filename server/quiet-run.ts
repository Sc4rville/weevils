// An automation run that did nothing is not news. A run that was skipped, stopped, found no new lead or changed
// nothing says so on its own automation page (its run line); it never becomes a For you card. This is the server's
// rule (server/foryou.ts post and session results, server/optimizers.ts landing cards), not a request to each
// automation: whatever a run's agent writes, a card that only announces « nothing happened » is not made.

/** A session that is an automation's run: its folder is under <projects>/.auto/ (optimizers.ts: .auto/.<id> for a
 *  repo-less one, .auto/<repo>/<id> for one working in a repository). */
export const automationRunDir = (cwd: string | undefined): boolean => !!cwd && /(?:^|[/\\])\.auto[/\\][^/\\]/.test(cwd)

const NOTHING: RegExp[] = [
  // skipped: the run, a batch, a turn (« I skipped this run », « run skipped », « Skipped: … », « X skipped: »)
  /^\s*skipped\b/,
  /\bi skipped\b/,
  /\bskip(?:ped|ping)? (?:this|the|today'?s|my) (?:run|batch|turn|time|round|pass)\b/,
  /\b(?:run|batch|turn|round|pass)(?: was| is)? skipped\b/,
  /\bskipped:/,
  /\b(?:was|were|got) skipped\b/,
  /^\s*(?:kept|still) (?:paused|stopped|on hold)\b/,
  /\bquiet (?:pass|run|night|round)\b/,
  // nothing started, found, changed, to report
  /\bnothing (?:else )?(?:was )?left\b/,
  /\b(?:left|leaving) (?:the |it )?(?:\w+ )?unchanged\b/,
  /\bno (?:\w+ ){0,2}(?:ideas|leads|findings|results|changes|issues|news) (?:this time|tonight|today|this run)\b/,
  /\bnothing (?:new|to (?:report|do|land|add|say|share|show)|changed|happened|found|was (?:started|done|changed|found|spent|made|added))\b/,
  /\bno (?:new )?(?:\w+ ){0,2}(?:was|were) (?:started|found|made|run|changed|added|shipped|produced)\b/,
  /\bno new (?:leads?|results?|items?|posts?|changes?|findings?|updates?|opportunit\w*|matches?|ideas?|issues?|mentions?|replies?|signals?)\b/,
  /\bno (?:batch|run|session) (?:started|run)\b/,
  /\b(?:didn'?t|did not|haven'?t|have not) (?:start|launch|run|find|change|produce|make|ship) (?:a |an |any |the )?(?:new )?(?:\w+ )?(?:batch|run|session|lead|leads|change|changes|result|results|anything)\b/,
  /\bno[- ]op\b/,
  // French
  /^\s*(?:sauté|ignoré|passé)\b/,
  /\b(?:j'ai|je n'ai) (?:sauté|passé) (?:ce|cette|mon|le|la) (?:passage|tour|lot|exécution)\b/,
  /\b(?:passage|tour|lot|exécution) (?:sauté|sautée|ignoré|ignorée|annulé|annulée)\b/,
  /\brien (?:de neuf|de nouveau|à signaler|n'a changé|n'a été (?:lancé|fait|trouvé|changé))\b/,
  /\baucune? (?:nouvel(?:le)?s? |nouveaux? )?(?:piste|pistes|lot|changement|changements|résultat|résultats|nouveauté)\b/,
  /\bpas de (?:nouvel(?:le)?s? |nouveaux? )?(?:piste|pistes|lot|changement|changements|résultat|résultats)\b/,
  /\bje n'ai (?:pas|rien) (?:lancé|trouvé|changé|fait|démarré)\b/,
]

/** The first sentence of a text, without markdown marks: what a card's headline says. */
function firstSentence(text: string): string {
  const plain = text.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
  const m = /^(.+?[.!?])(?:\s|$)/.exec(plain)
  return (m ? m[1] : plain).slice(0, 240)
}

/**
 * Does this card only say that nothing happened? Read on its headline (the title, the first sentence of the text):
 * a run that did something leads with it. A question to the person (a headline ending with « ? ») is never « nothing ».
 */
export function saysNothingHappened(o: { title?: string; text?: string }): boolean {
  const heads = [o.title ?? '', firstSentence(o.text ?? '')].map((h) => h.replace(/[*_`]+/g, '').trim().toLowerCase().replace(/[’‘]/g, "'")).filter(Boolean)
  if (!heads.length || heads.some((h) => h.endsWith('?'))) return false
  return heads.some((h) => NOTHING.some((re) => re.test(h)))
}
