# The onboarding, inside a new weevils

Once installed, a new weevils opens on weevboss's thread, and that thread is the onboarding: no checklist screen, no
tour that blocks, no buttons (actions are coloured links in the sentence). Everything that follows starts from the real
state, said by weevils itself (no model) unless written otherwise. Code: `server/journey.ts` (pure, tested),
`server/setup.ts` (says it), `next/src/tour.tsx` (the tour), `server/i18n/journey.ts` and `src/i18n/tour.ts` (words).

## The first five minutes

1. **The hello** (`Setup.welcome`): what weevils is and that it stays theirs, then what it already sees. Signed out:
   the subscription's sign-in (Claude's link, ChatGPT as the other pick). Signed in: « tell me what you'd like to
   make… Or first, a one-minute tour of the app. »
2. **The first milestone**, the subscription signed in: a win (the app's confetti, once), what it opens (« your agents
   can build now »), one example to try (« make me a small notes app ») and the tour. A request kept while signed out
   starts instead of the example.
3. **The tour** (weevils next only; the classic app's link says where it lives). A light veil that never takes a tap,
   a halo that glides from place to place (the side bar opens and closes by itself, a place off screen scrolls into
   view), and one line in weevboss's voice on an inverted band: what the place gives you, a count, « skip the tour ».
   The first stop is a real tap (the menu, which opens the side bar as always); the others are a tap-through. Stops:
   the menu, the projects (or where they will land), Autonomous (when there is an automation), Your factory, For you
   (when it is there), the field to write in, the camera. Escape or « skip » ends it; a place gone under the person's
   own tap is passed after 1.5 s.
4. **Its end** offers the next step at once.

## One step at a time

The steps, in order: the tour, GitHub, the phone, notifications, another machine (a machine that sleeps gets the
server offer of the sync instead, `vps:offer`). Each is offered once, by what it lets the person do, as a link:
`/#do=github`, `/#do=phone` (the QR code), `/#do=push` (the one tap, or how to add the app on an iPhone),
`/#do=computer` (the line for another computer).

weevils offers the next one by itself only when all of this holds (`mayOffer`): the first three days; weevboss idle
and its thread quiet for 90 s; the person wrote or passed a step since the last offer (nothing piles up in an empty
thread); at most three a day; and not after two offers passed by in a row (it stops; weevboss takes over, below).

## Milestones

A step passed is a real win, proven by the state, celebrated once, with what it opens and one example to try. An
example is a link (`/#do=try.<id>`) that sends that very request to weevboss as the person's own (a signed-in
browser's tap only, like any message), with a brief for weevboss to keep it small and show it working.

| Passed | Proven by | Opens | Example |
|---|---|---|---|
| Claude or Codex | the sign-in works | agents can build | make me a small notes app |
| GitHub | every conversation synced (the vault's « Done ») | pick any conversation up | what was I working on lately? |
| The phone | a second device signed in since the hello | agents in your pocket | what are my agents up to? |
| Notifications | notifications turned on (first time) | told the moment an agent finishes | ping my phone when a one-minute job is done |
| Another machine | it shows up online | agents run there | what can I run on my new machine? |

## The following days

weevboss, not weevils, carries on: from 20 hours after the hello to two weeks, the hidden block of its turn may list up
to three discoveries still open (the steps not done first, then automations, voice, the camera, ChatGPT as a backup),
each with when it fits and how to offer it. weevboss slips one in only when it fits what the person is doing in that
message, made concrete with what it knows of them (their projects, their memory), then marks it
(`weevils setup mark discover:<id>`). At most one a day: nothing is listed within 24 hours of a discovery, an offer or
a milestone, and a day's messages carry the list eight times at most. `weevils setup` shows where the journey stands.
