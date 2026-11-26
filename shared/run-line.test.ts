// Every sentence here is invented, on one neutral theme: a « Price watch » automation that checks the prices of a
// « shop-app ». None is copied from a real install; each keeps the shape (label, cut point, link, figures) its rule needs.
import { describe, expect, it } from 'vitest'
import { firstSentence, needsLine, runLine } from './run-line.ts'

describe('firstSentence', () => {
  it('keeps the first whole sentence, without the formatting marks', () => {
    expect(firstSentence('**Stopped:** the check could not run. Nothing was changed.')).toBe('Stopped: the check could not run.')
    expect(firstSentence('I ran `npm test` and [the page](https://example.com/p/x) is up! More later.')).toBe('I ran npm test and the page is up!')
  })

  it('reads a note whose line breaks were folded: a list dash starts a new line', () => {
    expect(firstSentence('**Done:** prices are in the table - **What changed:** the list shows ten. - Nothing blocked.')).toBe('Done: prices are in the table')
  })

  it('does not stop at a version, a decimal, an abbreviation or a lower-case follow-up', () => {
    expect(firstSentence('It moved to v2. then stopped at 3.5 GB, e.g. Shoes and Hats. Next run tomorrow.')).toBe('It moved to v2. then stopped at 3.5 GB, e.g. Shoes and Hats.')
  })

  it('a headline on its own line is whole, even with no full stop', () => {
    expect(firstSentence('# Run 12: skipped, no price checked\n\nWhy: the shop is closed.')).toBe('Run 12: skipped, no price checked')
  })

  it('a text cut before its first sentence ended keeps whole words only, then an ellipsis', () => {
    expect(firstSentence('**Done:** today’s price report is written and on your private page: [shop-app price report](https://example.com/p/rep…')).toBe('Done: today’s price report is written and on your private page: shop-app price…')
    expect(firstSentence('I checked three shops and everything matc…')).toBe('I checked three shops and everything…')
  })

  it('a cut text whose first sentence is whole shows that sentence', () => {
    expect(firstSentence('**Done:** this run found no new price. I checked three shops (Alpha, Beta and Gam…')).toBe('Done: this run found no new price.')
  })

  it('says nothing for nothing', () => {
    expect(firstSentence('')).toBe('')
    expect(firstSentence('  \n ')).toBe('')
  })
})

describe('runLine', () => {
  it('drops the « Done: » label of a run that went well: the check already says it', () => {
    expect(runLine('**Done:** I checked one new price list, which holds 4 items. - Nothing blocked..')).toBe('I checked one new price list, which holds 4 items.')
    expect(runLine('**Fait :** les prix sont dans le tableau.\n\n- deux nouveaux')).toBe('Les prix sont dans le tableau.')
  })

  it('keeps any other label as plain words: it is the news', () => {
    expect(runLine('**Stopped:** Price watch didn’t run again because I still can’t read the price list, so I couldn’t check the 80% rule.\n\nMore.')).toBe('Stopped: Price watch didn’t run again because I still can’t read the price list, so I couldn’t check the 80% rule.')
    expect(runLine('**Skipped: no price was checked this run.** No check was already running.')).toBe('Skipped: no price was checked this run.')
  })

  it('keeps « Done: » on a run that did not go well', () => {
    expect(runLine('**Done:** half of it. The rest failed.', false)).toBe('Done: half of it.')
  })

  it('leaves out the harness tag a report may open with', () => {
    expect(runLine('[harness: resumed] **Done:** the page is live. Open it.')).toBe('The page is live.')
  })

  it('reads a plain note with figures as it is', () => {
    expect(runLine('I read 2 price lists from the cache (≈ 13 k items kept), −79% requests over the last hour.')).toBe('I read 2 price lists from the cache (≈ 13 k items kept), −79% requests over the last hour.')
  })
})

describe('needsLine', () => {
  /** A whole report whose « Needs you: » line says `said`. */
  const asking = (said: string) => `**Done:** ok.\n\n**Needs you:** ${said}`

  it('reads what the last « Needs you: » line asks, as one plain sentence', () => {
    const msg = '**Done:** the new price list is saved.\n\n- 4 items per check\n\n**Needs you:** tap "Yes, resume" to start the checks, or "Keep it stopped". A check costs about $0.25/day.'
    expect(needsLine(msg)).toBe('Tap "Yes, resume" to start the checks, or "Keep it stopped".')
  })

  it('reads the French label too, and a label in a list', () => {
    expect(needsLine('**Fait :** tout est prêt.\n\n**À toi :** choisis la date de sortie.')).toBe('Choisis la date de sortie.')
    expect(needsLine('Done.\n- **Needs you:** a restart of the server.')).toBe('A restart of the server.')
  })

  it('a line that says nothing is needed asks nothing', () => {
    for (const none of ['nothing.', 'Nothing', 'nothing right now. The price files are written.', 'Nothing to validate this run.', 'nothing for now. The price list is empty.', 'none', 'rien.', 'rien pour l’instant.', 'Nothing. The report is written.', 'n/a'])
      expect(needsLine(asking(none)), none).toBeNull()
  })

  it('the other ways to say nothing ask nothing either', () => {
    // The long dash in two of them is what an agent writes: it is test input.
    for (const none of ['No action needed.', 'Nothing needed from you.', 'nothing — the run is complete.', 'nothing to publish. The report is updated.', 'aucune action requise.', 'rien à signaler.', '—', 'None at this time.', 'nothing, so no message goes out this week.'])
      expect(needsLine(asking(none)), none).toBeNull()
  })

  it('« nothing …, but … » and « nothing to do except … » still ask something', () => {
    expect(needsLine(asking('Nothing for now, but the merge conflict needs a look.'))).toBe('Nothing for now, but the merge conflict needs a look.')
    expect(needsLine(asking('Nothing to do except approve PR 12.'))).toBe('Nothing to do except approve PR 12.')
    expect(needsLine(asking('rien pour l’instant, mais dis-moi la date.'))).toBe('Rien pour l’instant, mais dis-moi la date.')
  })

  it('« none of … » and « no … until » are real news, not « nothing »', () => {
    expect(needsLine('**Needs you:** none of the last six pages has reached the site yet. The upload fails.')).toBe('None of the last six pages has reached the site yet.')
    expect(needsLine(asking('none of the last six pages has reached the site yet.'))).toBe('None of the last six pages has reached the site yet.')
    expect(needsLine(asking('no decision is possible until you pick a plan.'))).toBe('No decision is possible until you pick a plan.')
  })

  it('no such line: nothing', () => {
    expect(needsLine('**Done:** this run found no new price.')).toBeNull()
    expect(needsLine('He said the app needs you: that is a quote, not a label at the start of a line')).toBeNull()
    expect(needsLine('')).toBeNull()
  })

  it('the label needs its colon: words that only start like it are no label', () => {
    expect(needsLine('À toi de jouer : ouvre la page.')).toBeNull()
    expect(needsLine('- Needs your login to push.')).toBeNull()
    // Bold, and still no label: no colon after it, and a sentence around it.
    expect(needsLine('The price list **needs you** before it can go out.')).toBeNull()
    expect(needsLine('**Needs you** to sign in before the next check.')).toBeNull()
  })

  it('a French colon may sit after a no-break space, narrow or not', () => {
    expect(needsLine('**À toi\u00a0:** choisis la date.')).toBe('Choisis la date.')
    expect(needsLine('**À toi\u202f:** choisis la date.')).toBe('Choisis la date.')
    expect(needsLine('**Fait\u00a0:** tout est prêt.\n\nÀ toi\u00a0: choisis la date.')).toBe('Choisis la date.')
  })

  it('a bold label closed by a dash is a label', () => {
    expect(needsLine('**Needs you** — pick a name.')).toBe('Pick a name.')
    expect(needsLine('**Done:** ok.\n\n**Needs you** - pick a name.')).toBe('Pick a name.')
  })

  it('the last label counts, and a code block is not read', () => {
    expect(needsLine('**Needs you:** pick a name.\n\nLater.\n\n**Needs you:** nothing.')).toBeNull()
    expect(needsLine('```\nNeeds you: fake\n```\n**Done:** ok.')).toBeNull()
  })

  it('finds the bold label in a note whose line breaks were folded', () => {
    expect(needsLine('**Done:** saved. - 4 items per check **Needs you:** say whether to resume. Until then it skips.')).toBe('Say whether to resume.')
  })

  it('finds the bold label after a sentence on the same line, in a message of several lines', () => {
    expect(needsLine('Line one.\n\nIt changes nothing in the app. **Needs you:** decide whether to merge these tests.')).toBe('Decide whether to merge these tests.')
  })

  it('a label alone on its line asks what the next line that says something says', () => {
    expect(needsLine('**Needs you:**\n- Pick a name.\n- Confirm the price.')).toBe('Pick a name.')
    expect(needsLine('**Needs you:**\n\nPick a name.')).toBe('Pick a name.')
    expect(needsLine('## Needs you\n\nPick a name.')).toBe('Pick a name.')
    expect(needsLine('**Done:** ok.\n\n**Needs you**\n\n- Pick a name.')).toBe('Pick a name.')
  })

  it('a label alone with nothing after it, or with a « nothing » under it, asks nothing', () => {
    expect(needsLine('**Done:** ok.\n\n**Needs you:**')).toBeNull()
    expect(needsLine('**Needs you:**')).toBeNull()
    expect(needsLine('**Needs you:**\n- nothing.')).toBeNull()
  })

  it('a line of 20,000 blanks costs nothing to read', () => {
    const blanks = ' '.repeat(20_000)
    const messages = [
      `**Done:** ok.\n${blanks}the prices are saved.\n\n**Needs you:** pick a name.`,
      `${blanks}**Needs you:** pick a name.`,
      `**Done:** ok.\n${blanks}\n**Needs you:**\n${blanks}- pick a name.`,
      `${blanks}Needs you`,
    ]
    const asked = ['Pick a name.', 'Pick a name.', 'Pick a name.', null]
    needsLine(messages[0])
    messages.forEach((m, i) => {
      const t0 = performance.now()
      expect(needsLine(m), `message ${i}`).toBe(asked[i])
      expect(performance.now() - t0, `message ${i}`).toBeLessThan(50)
    })
  })
})
