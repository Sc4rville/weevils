# weevils next — how it moves and what it shows

The one reference for weevils next, the interface every install opens (folder `next/`; the classic app stays one address away, `?ui=classic`). Every
remark is checked against this page before any code changes. A remark that contradicts it changes this page first,
once, and the code follows. Behaviour is never flipped back and forth.

## Navigation: one model, like iOS

- **The base screen is weevboss**: its thread, or For you beside it (the words « weevboss · for you » at the top).
- **The side bar is a drawer from the left**, top to the very bottom edge (installed on a phone too). The ☰ button or an edge swipe opens it, and the edge swipe works on
  weevboss's screen only. It follows the finger. It closes past 38 % of its width or on a fling, and a tap outside it
  closes it too.
- **In the side bar, a project's name folds its sessions away or brings them back.** The fold opens and closes with
  the app's own motion (`Collapse`) and is remembered, as on the classic home. Its « / » and « > » keep their own
  taps. In the weevils block at the top, the logo opens weevboss and the name folds, like every project's name
  (2026-11-21; this replaces « the logo and the name open weevboss »).
  The **Autonomous** section (what runs on its own: automations and factories; it was « Automations » until
  2026-11-21, docs/automations/PROTOCOL.md) folds the same way, from its name. Its rows are one colour, a gentle staircase: each row
  one small tone step from the one above, like the stacked blocks of the weevils logo; no lines, no gaps, no shadows.
  Its last row runs straight into the settings below: colour alone separates the bands, never a strip (2026-11-22).
  A « + » right of its name, in the column of the projects' « > », makes a new automation and opens its talk, as the
  app's drawer does.
  **Settings** fold the same way, from their name: folded to their one band unless this device last left them open
  (2026-11-23), in both apps. Their name is regular weight, like Autonomous: bold in the side bar means active.
  **A repo row** carries a thin square repo mark in the weevils logo's column, its name under the « w » of weevils.
- **An automation row always opens the automation** (2026-11-21). Once accepted, it opens on its overview: its
  name in the middle in bold, what it does in one line, a big living link to what it produced (the page its newest run
  published, else that run's results), then its next run, its schedule, its last run and how it went, its count, where
  it works. A small « Conversation » in its header (no box) flips, with the app's fade, to the conversation it runs in
  (to read it or take it over); there it is exactly a session's screen (the same head, thread and box), and the automation's own icon, the last item of that one-row head, flips back to « Overview » (2026-11-23: never drawn over the title or the model). A draft or a proposal opens on the app's own talk page.
- **A factory has its own icon and its own page.** In the Autonomous section an automation wears the loop, a
  factory the factory icon (the same square with a saw-tooth roof and a chimney); while one runs, its own mark
  travels its outline. A factory's row opens on the page its manifest declares, drawn by the app's own `FactoryPage`
  (`src/ui/factory-page.tsx`): the same small flip goes to its conversation and back. An automation that earned it
  shows one quiet line under its overview's facts, « Ready to become a factory »: a tap unfolds what the unlock does
  and its two answers. Nothing else in next says « factory »: no badge, no counter.
- **Your factory** (2026-11-23): one band right under Autonomous, the same height, the same staircase, folded until
  opened (and remembered). Open, it holds four bands, each one tone step below the last: **Machines**, **Intelligence**,
  **Projects**, and the global **Tempo**. A level's name unfolds its own bands the same way (one per thing, a step
  further in), its last band a « + ». No section titles, no boxes, no buttons beyond the switches.
  - **Machines**: one band per machine: a computer or a server icon (what the machine found out about itself), its
    name (hold it to rename it in place), a thin health bar under the name (the fullest of processor, memory and disk;
    ink, then orange, then red; no figures there), and on the right a plain rectangular switch. Off: nothing new starts
    there (sessions, automations); with agents at work, one short line asks first and they stop. While agents work on
    it, its icon slowly moves through the colours. A tap opens the machine's own conversation: its health in figures
    and, for a server whose host is known, a link to the host's dashboard, on top; then the field, and once written to,
    the app's own session page (run on that machine). « + » brings weevboss's screen with its « add a machine » setup.
  - **Intelligence**: one band per subscription or API key, its provider's logo in monochrome (the app's own), its plan,
    a power bar under its name (what is left of its fullest window, from the provider's own meter: the working green,
    then orange, then red) and a switch where turning it off is possible (Codex: never handed work; a key: taken out of
    weevils' environment, never deleted). Claude has no switch: it carries weevboss. A tap on a subscription opens the
    app's subscriptions page. « + » unfolds what can be added (another Claude account, Codex, the API keys missing); a
    tap brings weevboss's screen: a sign-in through weevboss, a key only ever in the masked field.
  - **Projects**: one band per project and per repo of this machine, its own colour, and a switch: on, it is pinned (the
    app's own pin) and stays in the side bar even with no conversation; off, it leaves the side bar, and comes back by
    itself while one of its conversations works or needs you. A project never touched shows while it has conversations.
  - **Tempo**: the global Tempo as six cells (Standby to Swarm), filled up to the mode in use; you drag a finger across
    to change it (a tap does nothing); past the left edge is Pause. Locked modes stay out of reach and, while the finger
    is on one, say what opens it. After a change the app's own slim Tempo band slides in with what it will use.
  Machines, subscriptions and Tempo then leave next's settings (the classic app keeps them there).
- **A project's « > » is its requests, one column** (2026-11-21). One band per request, the Automations
  staircase (one colour, one small tone step per band, no lines, no gaps, no shadows). A band is a short title, a
  small star before it while its session works (the star's place is always kept, so titles never move), and a small
  bar for how far it is (not started, sent, being worked on, came back, done: facts, never a guessed percent). What
  runs now sits on top, then every request ever asked, the newest first, whatever its state; nothing is folded away.
  A tap opens a request in place (the whole sentence, your words, where it went, what came back, done / drop). No
  status words, no conversations on this page: they stay under the project in the side bar. It is the classic app's
  own column (`RequestColumn` in `src/ui/requests.tsx`), the same on its project page and its page of all requests.
- **A For you post's step always leads somewhere** (2026-11-21, after « Look » did nothing on an automation's post):
  an automation opens on its own page; weevboss's thread brings weevboss's screen, on its thread; « the automations »
  opens the side bar on its Autonomous section, unfolded. The rule is the app's (`src/ui/foryou-open.ts`); what next
  does for the two that are not pages is written once in `next/src/reach.ts`, and tested. A destination next cannot
  reach draws no button.
- **Backend stays out of the side bar**: the « auto » folder (where automations without a repo run) is never listed;
  « Misc » shows only when one of its conversations needs you. The automation loop shows only on the automation that
  runs and on the conversation it works in, never on a project nor beside the Autonomous name (2026-11-23).
- **Anything you open is pushed in from the right edge**: a conversation, « / », « > », a file, a photo, a session
  from a page. It does not matter where it was opened from (the side bar, weevboss's thread, For you or a page).
- **Back pops it out to the right edge**, with its chevron or with a swipe right that follows the finger. It uncovers
  exactly what was under it. If it was opened from the side bar, the side bar is there again, as it was.
- **weevboss alone moves vertically.** Over a session, weevboss is a strip at the top. A tap or a pull down on the
  strip brings it down over the session, with the session's colour fading through it. The « weevboss » row in the
  side bar does the same.
- **weevboss · for you** slide sideways, the way the words read: For you comes from the right.
- **One motion for everything**: the app's page spring (`spring` in src/ui/bits.tsx). The directions are written once,
  in `next/src/moves.ts`, and its tests pin them.
- **Reduced motion**: nothing slides. Every screen simply appears.

## What a conversation shows: the classic app's own components

- **A session** is the classic app's session page (`pages.tsx` SessionPage), and no copy of it. That gives:
  - tool activity titles;
  - questions and approvals with their buttons;
  - pause and error lines;
  - the short line of weevboss's briefs, with the full brief one tap away;
  - photos;
  - the composer, with dictation and files;
  - the app's stand-ins for sent messages (`src/ui/pending.ts`).

  The classic app shows the same view, threads on or off (PR #39).
- **weevboss's thread** is the classic message list (`Messages`), with its own setup buttons and working line.
  - Next adds only one thing: a stand-in for your message while it is sent (`next/src/pending.ts`). It ends when the
    server's copy arrives, even when that copy carries a photo, a file or weevils' context.
- **Who wrote it, in a session** (the server's author field, never a guess from the words):
  - the session's own agent (Claude, Codex): plain text on the page, no box, its name small above;
  - you: a tinted band reaching the right edge;
  - anyone else prompting it (weevboss, another agent, an automation, a bot): the mirror of your words, a band
    against the left edge, in that author's colour (weevboss's own, an automation's band colour under its name: it signs
    its own brief, 2026-11-23; or the author's stable colour, readable in every theme), its name small at the top (2026-11-22: only your own words sit on the right; this replaces « on the right
    exactly like your own words » of 2026-11-21).
- **Order**: messages are always shown in the server's order, each reply under its message. A stand-in only ever
  sits at the end and never stays once the real message is there.
- **Motion in a thread** is the classic app's own (`Appear`): a new message opens in place at the bottom. The scroll
  stays on the latest message unless you scrolled up to read.
- **Photos you sent** are a small rounded thumbnail in your message; several sent together sit side by side in one
  row that scrolls sideways (2026-11-21). A tap opens the app's photo viewer, pushed in like any screen, where a
  swipe goes from one photo to the next.
- **A conversation wears its repo's colour**, the one of its band in the side bar (weevils' own repo: its gradient).
  Tapping it is one motion in from the right, weevboss's strip travelling with it.
- **A session's screen gives the thread the room** (2026-11-22): its head is one compact row (the back chevron, the
  title, the model; no repo name, no logo: its colour says the repo) with no second gap under weevboss's strip; the box to write in is one line while
  empty, on the row of its +, mic and send, and grows as you type; under it, only the phone's own bottom inset.
  Whatever shows under the page (that inset, the bounce) wears the page's own colour, never another band's
  (weevils' repo: its gradient's base). The
  « new below » mark (a « ? » when a question waits) is a quiet tone of the page, never a dark block over the text.
- **Focus never draws a black box**: a field shows where you type by its caret; a button reached with the keyboard
  gets the app's one soft halo.
- **Next's own layout choices**, the only ones (2026-11-21):
  - no thin lines anywhere (side bar or threads): separation is tone and room only;
  - weevboss's box to write in runs edge to edge with no frame;
  - your messages on weevboss's screen reach the right edge;
  - weevboss and the weevils repo are one block at the top of the side bar.

## From the classic app

next takes the classic app's light features as they are, never as copies, so they follow by themselves
(scripts/next-parity.test.ts keeps them):
- **Settings**: the app's settings band (theme, language, requests, log out; machines, subscriptions and Tempo are in
  Your factory); its last line goes to the classic app.
- **Notifications**: the app's service worker and push subscription; a tap opens its session, or weevboss.
- **Page links** (/p/…) opened outside the app: the page, once signed in.

Left out on purpose (clutter, or a duplicate of what next shows another way): the 24-hour band (the Autonomous
section), the second opinion, the relay page (reached from the subscriptions), weevbook, the calm grid, the hint
bubbles, tip cards and ghost finger.

## Audit, 2026-11-21

Each screen and gesture was checked against the rules above and against the classic app, in a phone-sized test
browser.

| What was off | Now |
|---|---|
| Opening from the side bar came in from the left; back went out to the left | In from the right, out to the right |
| Back from a screen opened from the side bar landed on weevboss | The side bar is there again |
| A session opened from a page threw the page away; back skipped it | It is one more page; back returns to the page |
| Four different springs (weevboss, side bar, pages, panes) | One: the app's page spring |
| Next's own « unroll » on arriving messages ran on top of the app's own motion (it looked like it came the wrong way) | Removed: the app's motion only |
| The session page had its own motion switched off | On |
| Sessions showed the plainer threads view (no tool titles, a different question format, a stand-in that could show twice) | The full session view, in both apps |
| A sent message's stand-in stayed at the bottom when the server added a photo or context (it looked like a duplicate, out of order) | It ends when the server copy arrives; tested |
| A photo filled the thread and opened in a new tab | A thumbnail; tap opens the viewer |
| The edge swipe could open the side bar while swiping back on a page | Only on weevboss's screen |

Known differences that remain, by design:
- weevboss's own screen layout (the star sky, the words, the panes) exists only in next;
- a session opened from inside a page has no weevboss strip above it (it is a page on that page).
