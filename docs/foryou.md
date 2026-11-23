# For you — plan

Written on November 10, 2026. Branch `feat/foryou`. Starts from the draft of an earlier session
(`origin/feat/foryou-draft`, `docs/foryou/plan.md`): its skeleton is kept (typed items in a server module, pacing
computed by the server, « weevboss · for you » at the top, a participant filter, actions that slide out of the
stream), re-checked against `main` and completed where it was thin (history, media, cost, what weevboss really is).

The brief, in one line: next to weevboss, a stream that makes the user's « company of agents » **readable**
(what happens, playfully), **actionable** (a lot can be done from it), a place to **learn** (go further on what the
agents touch) and **hard to put down** (a sensory, living factory) — in weevils' own look: full bands, colour only,
no border. The numbered categories of the paper sketch are content types; their names are never shown.

In the code the feature is called **for you** (`foryou`): « feed » already names the home list of project bands.

## 1. What is true on main today (checked)

- **No history anywhere.** Everything is current state rebuilt from transcripts; a session that finished, an alert
  that resolved, a mail that came in leave no trace weevils can list. `Snapshot.main` is the last 40 messages only.
  → the stream needs its own persisted store.
- **The whole snapshot is re-sent to every device on every change** (SSE carries a version number only).
  → the stream travels on its own route; the snapshot carries a revision and an unseen count, nothing else.
- **weevboss is purely reactive**: a real Claude Code session woken only by a message. It never posts on its own, and
  every wake-up is a full turn on the subscription. → its « words » in the stream are written by weevilsd with the
  cheap headless helpers (`server/fast.ts`), in its voice, and weevboss itself gets a verb to post when it wants to.
- **Mail bodies are not kept** (`mail.json` holds ids only) and the sender's address is lost after the reply.
- **No media route**: nothing serves an image or a video from a path, no video MIME type, no `Range` (iOS will not
  play a video without it), no `<video>` in the app. Media on disk is 97 % exhaust (frame dumps, worktree copies):
  scanning folders would be slop by construction.
- **Proposals exist**: `snap.optimizers` (state `proposed`, accept/refuse routes) and the personal tips
  (`personalTips()`, cards with an action). Another session is reworking optimizer proposals right now: the stream
  only reads them and calls their routes.
- **Real volumes** (2–3 days of use): 10–28 real sessions a day (the richest source), ~40 % of all sessions are test
  probes (`isTestBrief`, headless) and must be filtered, ~1 outside mail a day, 0–3 proposals per 6 h round, memory
  still empty on the real instance. Padding thin signal would be slop: the stream is **finite** and says when the
  user is up to date.
- **Gestures already taken**: the home stack swipes left to the repos, every page swipes right to go back. A carousel
  must scroll natively and stop the pointer from reaching them.
- **House rules that bind**: every string in a catalog (fr + en), every theme (light, dark, zen, graphite, desert, synthwave, botanical, vaporwave, coastal, deco; see docs/themes.md), flat
  bands, sharp corners, no shadow, character icons, nothing moves under the finger, `bands.test.tsx` (sending never
  opens the full-screen thread).

## 2. The stream

### 2.1 Items (`shared/foryou.ts`)

One type, `ForYouItem { id, kind, tone, at, who, projectId?, sessionId?, title?, text, body?, media?, cards?,
actions?, reply?, open?, more?, seen?, live? }`. `who` is the speaker (weevboss, an author id, `session`,
`weevils`) and the participant filter. `tone` picks the colour family.

| kind | what it shows | where it comes from | what can be done |
|---|---|---|---|
| `media` | a render, a clip, a screenshot the user asked for | **published on purpose**: `weevils show <file> "caption"` from any session or weevboss; files cited in the last message of a finished turn | play / look full screen, reply to the session, open it |
| `boss` | weevboss as a readable CEO: what was sent, what came back, sometimes a thought tied to the user's goals, sometimes actions | `weevils post "…"` (weevboss itself) and the **digest** written by weevilsd in its voice from what really happened since the last one + the memory | reply (a real message to weevboss, with the post as hidden context), launch a suggested action, open the thread |
| `mail` | a discreet line: who, a short « I did this » | the mail bridge, recorded at dispatch (author, subject, text, target) | unfold the whole mail in place, reply by mail |
| `proposals` | suggested automations, as a split carousel when there are several | `snap.optimizers` (proposed) + personal tips with an action | ✓ / × per card; the card leaves sideways |
| `session` | project · session · what it did (green), what it asks (amber), why it stopped (alert) | status transitions recorded with the last assistant message; one item per session, replaced by its next turn | reply inline, open the real conversation, resume when cut |
| `improve` | a way for weevils to serve this user better, drawn from how they use it | generated (rarely) from usage patterns, machine advice and tips | « do it » (a brief to weevboss), reply, dismiss |
| `alert` | what needs the user now, sober | live state: sessions waiting or cut, a usage window nearly full, a saturated machine, a failed auto task | open the place where it is solved; it leaves by itself once solved |
| `insight` | bold text, like a page you learn from: something true about the stack or the tools the agents are using | generated per repo from what is really in it (dependencies, languages, recent commits), cached | « more »: a longer answer unfolds in place |
| `milestone` | a big number or a first time, in colour-shifting type | deterministic counters (turns delivered today, commits, first auto task done…) | — |
| `stat` | where things stand, as bars: a usage window, today's turns per project, the auto queue, a machine | plain counters from the snapshot, usage and infra (no model) | open the place it speaks of |

Sketch → kinds: 1 media · 2 boss · 3 mail · 4 proposals · 5 session · new idea: improve · 6 alert · 7 insight,
milestone and stat.

Added by the user while step 1 was being built:

- **Voice messages.** A word from weevboss or from an outside actor can be listened to: the item carries a play
  glyph and a moving wave, a tap reads it aloud. Every speaker has **its own voice**, always the same one (weevboss
  keeps the app's voice; each author gets one from the available voices, by a stable pick, overridable in its
  declaration). It reuses `GET /api/speak/stream?text=…&voice=…`; nothing is synthesised before the tap. Some items
  are voice-first (the digest's thought, a short mail): the wave leads and the text sits under it.
- **Figures as shapes.** Bars and small gauges, as their own item (`stat`) and under other items when they say
  « we are here » (a usage window at 71 %, 12 turns delivered of 18 started, the auto queue, a project's share of
  the day). `ForYouGauge { label, value, max, shown, projectId?, hot? }`. They fill when they come into view.

### 2.2 Not slop

- **Media is opt-in by the author**, never scanned. A file enters the stream because an agent published it
  (`weevils show`) or named it in the message that ends its turn. Caption, session and project come with it.
- **One item per session**, not per turn: the newest result replaces the previous one.
- **Test and headless sessions never enter** (`isTestBrief`, headless, sessions under weevils' data, weevboss's own).
- **Generated text is rare, grounded and capped**: it quotes what happened (titles, repos, counts) and is refused
  when it does not parse or repeats an earlier item (same Jaccard test as the optimizers).
- **Insights only state well-established facts** about things really present in the repo; the prompt forbids
  numbers and dates it is not sure of, and « more » lets the user dig.
- **The stream ends.** After the last item, one line says the user is up to date. No infinite filler.

### 2.3 Order and pace (`arrange()`, pure, tested)

Score = freshness × weight of the kind (alert > session question > mail > session result > boss > proposals > media
> improve > insight), unseen before seen. Then a pacing pass: never two items of the same kind in a row when it can
be avoided, a fresh media opens the stream when there is one, the proposals carousel sits around the third place,
one insight or milestone every ~5 items, alerts stay on top. On the device, the order is frozen while a finger is
down or the stream is moving (`isSettled()`); newcomers wait behind a « new » mark at the top instead of pushing
what is being read.

## 3. Server

### 3.1 `server/foryou.ts` — the store and the sources

Class `ForYou(w, deps)`, built like `Optimizers`: JSON file `DATA_DIR/foryou.json` written tmp + rename, capped
(400 items, 14 days), `w.bump()` on change, main machine only (`ORCHESTRATOR`), everything testable without
`index.ts` (injected clock, `sys`, `memory`, `usage`, `infra`).

- **Recorded** (events, persisted): `session` results and questions (hooked where `notifyTransitions()` already sees
  working → idle/done/needs_user and `announceCuts()` sees a cut; the first pass after a restart stays silent, the
  store carries the history), `mail`, `boss`, `media`, `improve`, `insight`, `milestone`.
- **Live** (computed at read time, `live: true`): `alert` and `proposals`. They disappear with their cause.
- State per item: `seen`, `gone` (dismissed or acted on), `moreText`.
- `feed(now, lang)` → `ForYouFeed { rev, items (≤ 60, arranged), pulse }`. `mark()` → `{ rev, unseen }` for the
  snapshot (`Snapshot.foryou?`).
- The result text of a session is its last assistant message (compaction preambles skipped, 600 chars). Remote
  sessions go through `detailAny()`.

### 3.2 Routes (`foryouRoutes`, spread next to the other route tables)

| route | what |
|---|---|
| `GET /api/foryou` | the stream; also tells the curator the app is looking (`lastWanted`) |
| `POST /api/foryou/seen { ids }` | marks items seen (cross-device) |
| `POST /api/foryou/:id/dismiss` | removes an item |
| `POST /api/foryou/:id/act { action, card? }` | runs a button: accept / refuse a card (optimizer or tip), send a boss brief, resume a session |
| `POST /api/foryou/:id/reply { text }` | session → `w.send` ; boss → `sendMain(text, brief quoting the post)` ; mail → a mail to the author in the same thread |
| `POST /api/foryou/:id/more` | insight: a longer answer (`smart`), cached in the item |
| `POST /api/foryou/post` (local only) | `weevils post` |
| `POST /api/foryou/media` (local only) | `weevils show` |
| `GET /api/foryou/media/:id` | the bytes, with `Range`, video MIME types, auth cookie |

### 3.2b What one person reviewed (`server/foryou-results.ts`)

Hand-reviewed presentation of one person's own feed is their data, never the product's: it names their projects,
sessions and files. It lives next to the feed, in `<data>/foryou.json.reviewed.json` (absent by default: the feed is
shown as recorded), read again whenever the file changes:

```json
{
  "results":   [{ "key": "shop-alcove", "anchor": "<feed item id>", "projectId": "shop-app", "sessionId": "<id>",
                  "title": { "en": "The alcove", "fr": "L’alcôve" }, "intro": "One line about the piece.",
                  "final": { "file": "renders/alcove_l.png", "sha256": "<hex>", "at": 1794337730636 },
                  "media": { "ids": ["<media id>"], "names": "^alcove_[pl]\\.png$" },
                  "otherTitles": { "studio_p.png": "The studio" } }],
  "captions":  { "<media id>": { "title": "Outside the café", "description": "What the picture shows." } },
  "examples":  { "result": "<media id>", "clip": "<media id>", "poster": "<media id>" },
  "editorial": [{ "id": "<item id>", "kind": "improve", "source": "<the exact recorded text>", "text": "<the reviewed wording>" }],
  "intents":   [{ "cardId": "<item id>", "actionId": "a1", "brief": "<the action's exact brief>", "sessionId": "<id>",
                  "messageId": "<id>", "intentId": "request:<session>:<message>:<slug>" }]
}
```

- `results`: a verified result leads its card (`resultGroup`): the finished file (relative to the anchor's working
  folder) only while its bytes match the hash, the media of the same piece folded under it as history, the reviewer's
  title and intro in the app's language (a plain string is the same in every language).
- `captions`: what a picture shows, carried on the media (`caption`) and used by the in-card rails.
- `examples`: media the formats page (`/#formats`) shows first; without them it takes the latest picture and clip of
  the person's own feed.
- `editorial`: a wording corrected against its exact source; a later text is never overwritten.
- `intents`: a proposal tied to the request that already covers it, so it is not asked twice.

### 3.3 Media (`server/foryou-media.ts`)

`weevils show <path> ["caption"]` registers a file: it must exist under the projects roots, the inbox or weevils'
data, be an image or a video by extension and sniffed header, and stay under a size cap (image 25 MB, video 400 MB).
The store keeps `{ id, path, type, bytes, mtime }`; the route serves only registered ids, streams with
`206 Partial Content`, and never follows a path from the request. The calling session is found from `$WV_SESSION` /
the cwd when present, so the item knows its project. Files cited in the closing message of a turn are registered the
same way (same checks, at most 4, dot-directories refused).

**Mockups** (`shared/mockup.ts`, `src/ui/foryou-mockup.tsx`). In a post, every picture or clip sits on a support drawn
in CSS, sized to the post, on the post's own colour (no box around it), in the language of the weevils logo: sharp
corners, and a thickness drawn as two flat faces (the side that faces the eye and the bottom), each one shade of the
logo, joined at the corner on one clean edge; never stacked offset copies, never a glass glare. An interface is never
put in a drawn device: `phone`, `browser` and `tablet` show the capture itself as the front of the
block, big enough to read (up to 92% of the post's width and 76% of the screen's height for a phone screen), flat
under the eyes, with no bezel, button, bar or rounded corner; they differ only by shape and width. The others: `print`
(a still or a render on a thin block, leaning a little), `cinema` (a clip that is not an interface, on a violet screen
with a green light), `board` (a diagram or a before/after on a thick block, flat in view). The shelf reads a still's
pixel size from its header, so the support is sized before the bytes arrive; a clip's size comes with its metadata.
`pickMockup` decides: `.diagram.` / `.compare.` files → board, always (a phone's shape would cut a before/after); 2:1
or taller → phone (a longer capture shows its top); wide and named like a screen (screenshot, capture, desktop,
page…) → browser; 4:3 named like a screen → tablet; otherwise print for a still, cinema for a clip. `weevils show
<file> --mockup <name>` forces one (kept for that file). A still's support turns slightly while the post is off-screen
and settles in view (transform only, nothing at all with reduced motion); the full-screen viewer shows the media bare.

**Clips play inline, on iPhone too.** A clip is muted as an attribute (React sets only the property; iPhone autoplays
only muted, inline clips), `playsinline` / `webkit-playsinline`, starts when it is under the eyes and pauses when it
leaves, and never sits in a 3D-turned block (iPhone may leave a video blank there): its support only grows in, flat.
Until it really plays, its poster shows (`GET /api/foryou/media/:id/poster`, its first frame drawn once by ffmpeg into
`foryou-posters/` next to the shelf; without ffmpeg, the `#t=0.001` fragment shows the first frame) with the play mark
on it, so a clip is never a black box; a tap opens it full screen, with sound.

**Direct link** (`shared/post-link.ts`). When what a post shows lives at an address (a site, a preview, a page, an
app screen), the post carries it: `weevils show <file> "caption" --link <https://…> [--link-label "label"]` (and
`weevils post … --link`), or `weevils link <post id> <https://…> ["label"]` for a post already out (POST
/api/foryou/:id/link, this machine only). Under the title, a living link in the preview colours says the label, else
the address's host and path; a tap on the media opens it too (one of this weevils' pages in place, anything else in a
new tab) instead of the full-screen viewer. Only an http(s) address someone else's phone can open: localhost,
loopback, private networks, `.local` / `.internal` names and bare machine names are refused with a plain sentence.
Sessions and weevboss are told to pass it whenever their visual result has an address (`server/i18n/agent-tools.ts`,
`server/orchestrator.*.md`).

**Before/after** (`server/compare.mjs`). A change shown as two states is one picture or one clip, made by
`weevils compare <before> <after> <out.compare.png|.mp4> [--crop x,y,w,h] [--crop-before …] [--crop-after …]
[--layout auto|stack|side]`: a neutral ground (#e9e6df) that stands apart from every theme's band, two frames with a
black edge, each under a big tag (BEFORE black, AFTER fluo green), cropped on the same area and zoomed to the frame's
width; stacked for wide crops, side by side when both are tall. Two clips become one: a neutral opening card (the play
mark has nothing to cover), then before, then after, each tagged. The caption says what changed, once; the picture
carries no caption of its own. `weevils show` refuses a file whose caption or name says before/after (or avant/après)
unless it ends in `.compare.png` / `.compare.mp4`.

**Diagrams** (`server/diagram.mjs`). Backend work (server, API, data flow, sync, security, automation) is shown as a
drawn diagram, not a screenshot of a terminal or code. The source is a mermaid flowchart, the subset agents already
write, with three additions: a kind per part (`:::phone`, `:::machine`, `:::server`, `:::agent`, `:::repo`,
`:::automation`, `:::data`, `:::cloud`, `:::person`, `:::page`, `:::lock`, `:::notify`; guessed from the words when
missing), `:::new` / `:::changed` / `:::gone` on what changed, and `==>` for a new flow; a `title:` front matter puts
a heading with the weevils mark on top. `weevils diagram <flow.mmd> [out.diagram.png]` draws it, `weevils show
<flow.mmd> "caption"` draws and shows it in one go, `weevils compare <before.mmd> <after.mmd> <out.compare.png>` puts
two side by side under the BEFORE / AFTER tags. The picture: the compare ground with a black frame (it stands apart
from every theme), always top to bottom (a phone is taller than wide), white tiles with a black edge and a hard
shadow, each with its icon from the weevils set on the kind's signature colour, right-angled flows coloured by the
part they leave (shades at ≥ 4.5:1 on the ground), labels in chips; every tile is a solid block (a side face and a
bottom face in the logo's shades); what changed gets a NEW tag, a deeper block with green faces and a green glow, a new flow is thick fluo green. At most 8 parts, labels of 28
characters, no ids: the renderer refuses the rest with a plain sentence. A visible UI change stays a screenshot or a
clip.

**Evidence labels** (`shared/evidence.ts`). A result says how far it was seen working: *implemented* (« Built »: the
code exists, nothing seen running), *demonstrated* (« Shown working », with where: a clip, a screenshot, a test
server) or *verified* (« Verified », with the environment it was checked in, shown next to the label). The level comes
only from the structured `evidence` sent with the publication, `weevils show|post … --demonstrated "where"
--verified "environment" --limit "what was not checked"` (`{ demonstrated?, verified?, limits? }` on the routes); never
from the caption, the item's words, a commit message, a PR title, a branch name or the agent's « works / tested ». An
agent's media result without any is « Built ». Each `--limit` is kept word for word and always shown under the claim
(never folded, translated or summarised away); while one is open the result is never shown as verified (it stays
« Shown working » where it was checked). Later files joining an item add their limits, never remove one. The server
derives the label at read time and the app applies the same rule again; the curator passes an `[evidence=…]` tag
with every source line so a digest or a suggestion does not claim more than the evidence.

### 3.4 weevboss (`server/weevils-cli`, `server/orchestrator.{fr,en}.md`)

Two verbs, documented in both prompts: `weevils post "text" [--action "label::what to do"]…` (a word in the stream,
with optional buttons whose brief comes back to weevboss when tapped) and `weevils show <file> "caption"`. The
prompt tells it when: after dispatching several things, when something is worth the user's eyes, and to ask the
sessions it briefs to `weevils show` their visual results.

### 3.5 The curator (`server/foryou-curator.ts`) — generated content, on a budget

**Current user override:** the timed editorial reservoir is disabled by default after complaints about repetitive
voice cards. Existing `r:` cards are hidden even on reload. Generated summaries, mail and automatic proposals are
not automatically voiced; explicit personal posts retain voice. The queue remains private history, not publication.
The reservoir mechanics below describe the retired experiment, not an active two-items-per-minute promise.


One single-flight loop spends the model budget; publication has its own persistent queue:

- While the app has requested the feed within 30 minutes, a 30-second timer publishes at most one queued story.
  It never catches up with a burst after downtime. No model call is needed to publish an accepted story.
- `foryou-curator.json.reservoir.json` holds up to 72 stories, publication time, last refill time and the last
  300 published texts. Atomic private writes and stable item ids preserve the queue across restarts.
- At 24 stories or fewer, a batch can prepare up to 24 candidates, no more often than every two minutes.
  Candidates require a short title, a supported format, text of at most 600 characters and existing source ids.
  Sources are the user's saved goals and recorded results/media/insights. Unknown sources, ACKs, engineering
  notices and lexical duplicates are rejected. The prompt also forbids semantic repeats and invented events.
- Ideas, fictional mini-stories, questions, observations, supported before/after accounts and discoveries alternate
  where available. No image is fabricated or implied by a text-only story. Titles stay visible; transcripts start
  collapsed and audio does not change the card identity.
- A refill receives real exposure/removal signals. Seen means displayed, removed means removed: neither is a
  satisfaction score. There is no model-weight training, invented engagement metric or claim of learned taste.
- Stories expire after six hours or when a cited source disappears. An empty queue stays empty until useful
  candidates are available; two publications per minute is not a promise of unlimited daily output.
- Model calls still obey the existing quota gates and daily budgets: 60 full-mode calls, 120 relay calls and 16
  lean-mode calls, including other curator work. All counters survive restarts. Failures back off one hour,
  doubling up to twelve hours. Questions needing clear wording have priority over refill work.
- Generation requests use a provider JSON schema. Balanced JSON extraction and trailing-comma repair are local;
  truncated payloads are rejected. A proven malformed JSON/schema response waits five minutes, doubling to one
  hour; quota/auth/transport failures keep the longer backoff. Private bounded diagnostics retain failures without
  putting prompts or provider errors in the feed.
- A private `.incoming.json` beside the queue accepts an explicitly authored batch through the same source and
  deduplication gates. It is consumed once; it is not a public endpoint or an automatic source of filler.
- An operator-authorized `.retry-once.json` beside curator state can name the exact `expectedFailUntil` to probe
  after a repair. It is consumed once, spends the normal daily budget and still checks real quotas/authentication.
  Failure preserves the previous backoff; ordinary restarts do not clear it.
- Other producers keep their cadence: digest at most every five minutes after changes, improvement every twenty
  minutes, insight every ten minutes and at most one per repo/day, plus batched mail summaries.
- Prompts live in `server/i18n/foryou-curator.ts` (French and English). Generated items keep their language.

## 4. App

### 4.1 Where it lives

- **Top band**: two small words under the logo row, `weevboss · for you` (the active one in full ink, like
  `.word.on`). The choice is remembered on the device. On « for you », the preview area shows the stream's first
  items as thin coloured strips (speaker · one line), scrollable in place; a tap opens the stream full screen. The
  field below always writes to weevboss. A dot on « for you » says there is something unseen. Sending never opens
  anything (the pinned invariant holds), and the thread preview stays mounted.
- **Full screen** (`Page { kind: 'foryou' }`): its head carries the same two words (« weevboss » closes the page
  and opens the thread in full), then one line of participants scrolling sideways: everything · weevboss · each
  outside author · sessions · media · ideas. One tap isolates a participant; the choice is kept.
- **Open thread** (band expanded): the two words stay, « for you » opens the page.

### 4.2 Look

Every item is a full-width band with its own `--c`; inner zones use `.tone`; nothing has a border, a radius or a
shadow. Colours: result → a green derived from `--fluo` readable in the four themes; question → `--h24` amber;
alert → `.invert` / `--alert`, one line, no giant « ! »; boss → `--agent`; mail → the author's colour, thin;
proposals → the auto palette (`propColors`), **always recognisable by the same trait**: a `+` glyph leading the
title and the ✓ × pair on the right, whatever the form (carousel of 2–3, one wide band, or a band with a reply
line when the proposal is a question); media → edge to edge, capped at 62 dvh, caption on a tone strip of its
context colour (green when it is a result); improve → a slow moving gradient (the one place colour goes wild);
insight → the project's colour, 1.375rem / 800 type; milestone → gradient-clipped type that shifts.

### 4.3 Motion and senses (the factory)

- **The line** at the top of the full-screen stream: a thin strip with what is turning now — stars spinning for
  working agents, counts for « delivered today », « waiting for you », auto tasks. It is the only thing always
  alive.
- Items enter with the house spring, staggered 40 ms for the first six; later ones fade up as they reach the
  screen (once).
- **An action leaves sideways**: accept, launch, dismiss → the band slides out to the right, the next ones close
  the gap (layout spring), a short « sent » flash where it was. Refuse leaves to the left.
- Video plays muted while in view and pauses outside; a tap gives sound and full screen. Images get a slow 1 → 1.03
  drift while in view.
- Unseen items carry the dot and heavier type; they are marked seen after 1.2 s in view.
- A light tap vibration where the device allows it (accept, send). `prefers-reduced-motion` keeps opacity only.
- The stream ends on « up to date », with the time of the last look.

### 4.4 Files

`src/ui/foryou.tsx` (page, items), `src/ui/foryou-top.tsx` (the two words, the preview), `src/ui/foryou-store.ts`
(fetch on `snap.foryou.rev`, optimistic act / dismiss / seen), `src/ui/foryou.css` (prefixed `fy-`),
`src/i18n/foryou.ts`, tests next to them. `AgentBand` gains the words row and the preview sibling; `Page` and
`PageView` gain `foryou` and `media`.

## 5. Steps (each one ends deployed)

1. **Foundation** — contract; store, sources without a model (session, alert, proposals, mail record, boss posts by
   verb), routes, media route and `weevils show` / `post`; app: words, preview, page, the nine renderers, reply,
   act, dismiss, seen. `npm run check`. Blank instance + isolated server on the real data. Deploy.
2. **Curator** — digest, improve, insight, milestones, the two summaries, budget and back-off, language. Tests with
   `fast.ts` mocked. Isolated server on the real data (real model calls, watched). Deploy.
3. **Feel** — the line, entries and exits, video behaviour, unseen, filters, the four themes, wide screens; demo
   world seeded with a stream; screenshots of every kind in light and dark; motion harness on the top-band scenes
   (no jump when switching words). Review by independent readers, fixes. Deploy.
4. **Close** — changelog, weevboss's prompt live, this plan updated with what was actually built.

## State on November 10, 2026 (evening)

Built, on `main`:

- **Step 1, live**: the store and its routes, the media shelf with `Range`, `weevils post` / `weevils show` and
  weevboss's prompt, the two words at the top, the preview, the full-screen stream with its participant filter, a
  renderer per kind, inline replies, actions. Checked on a throwaway server seeded with every kind, then booted on
  the real transcripts (which showed a wall of old cuts at first start: only those under 12 h now get an item).
- **Step 2, merged, live at the next restart of weevilsd**: the curator (`server/foryou-curator.ts`: digest,
  improve, insight and « more », milestones, « where the day stands » bars, one-line mail summaries) on its budget,
  and a voice per speaker (`server/foryou-voice.ts`). Session results are not summarised by a model: the band
  already shows project · title above the closing words.
- **Step 3, live** (app only): voice messages, bars that fill, the rolling counts of the line, exits over « lancé /
  envoyé / écarté », media kept whole, wide screens, the unread dot in the margin.

Changed after the first look on the phone (same evening): a session's result is **one line said in passing**
(`headline()`: no markdown, path, command or machine tag; the curator rewrites it in the first person when the budget
allows), the whole report and the reply unfold under it; the stream is **newest first**, so news always comes in
at the top (held behind « n new » while reading; only system alerts sit above); turns that ended in the last 24 h
before the stream listened get their item; the curator makes no call before the usage figures are known (one digest
was written blind at a start, at 90 % of the week).

Not checked yet, to do on a device or with real traffic:

- the texts the curator writes (no real model call was made while building: the prompts are untested on real
  data — read the first digests, insights and improve ideas and tune `server/i18n/foryou-curator.ts`);
- « resume » from the stream and a reply by mail through the real bridge;
- on an iPhone: the carousel against the page's swipe-back, muted inline video and its pause out of view, the
  audio of a voice message (unlocking on tap, the logo and an item silencing each other), the tap vibration;
- a running weevboss conversation only learns `weevils post` / `weevils show` at its next conversation.

Known rough edges: an image has no height until it loads (the server sends no dimensions), so what is below
shifts once; the « sent » band is white in the dark theme; the line wraps on two lines with four counts; a card
leaving the carousel shows no word; no per-author voice override; a session's `weevils post` is signed weevboss;
the stream is main-machine only (media of a secondary machine cannot be shown); the demo world of the
content repository is not seeded with a stream yet.

### Handover (November 10, 2026, Claude at its weekly limit — Codex takes over)

Done and live: human tone (curator prompts, alerts, figures, milestones), question cards read by a light model
(title + clear question + option buttons sent to the session; « not really a question » becomes a result), pace
(never twice the same sort in a row, newest first within 4 places), history of 4 days (backfill 40 per pass,
stream up to 160), auto tasks started / finished as items, curator modes: full (Claude < 85 %), relay (everything
through `codex exec`, `relay()` in `server/fast.ts`, 120 calls a day since), lean (haiku only up to 98 %, 16 a day).

Left: commits and deploys as items (git log of active repos, free); new proposals as an event; the weevboss band
asked by Scarville — logo a little higher and a taller thread preview when folded, and weevboss full screen must be the
same frame as « pour toi » full screen (same head « weevboss · pour toi », whole screen, no jump when switching):
today the open band is smaller than the page. Check with iPhone screenshots (folded, full screen, switching).

## 6. Checks

- `npm run check` (typecheck app + server, i18n, shell lint, tests) before every merge.
- Pure tests: `arrange()`, the store (cap, replace-per-session, gone/seen), media registration (path jail, sniff,
  Range arithmetic), curator (budget, back-off, parse, dedup), routes' trust (`post` and `media` local only).
- UI tests: the words row keeps `bands.test.tsx` green; preview and page render each kind; act → the item leaves;
  reply goes to the right route.
- Live: throwaway server from the worktree with its own `HOME`/`TMUX_TMPDIR`/ports (blank), then the same against
  the real data read-only-ish (own tmux socket, no weevboss), then a blank Docker instance (`FRESH_NAME=weevils-foryou`).
  Never `tmux kill-server`, never the live instance for a test.
- Deploy: rebase on `main`, fast-forward `main`, `heavy npm run build`, `systemctl --user restart weevilsd`, push.

## 7. Risks

- **Parallel work on main** (auto proposals, memory, softwares, fluidity, language, usage): small surface in shared
  files (`AgentBand`, `App.tsx`, `core.ts`, `index.ts`, `weevils-cli`), rebase before each step, never restore an
  older version of a file.
- **Cost**: the curator is a new spender; budget, usage gate and « only when looked at » are part of step 2, not an
  afterthought.
- **Privacy**: mail bodies and results now persist in `foryou.json` (mode 600, same place as the rest); nothing of
  it goes into push notifications or the snapshot.
- **Height of the top band** when switching words: both previews share the same box, so nothing below moves.
- **A running weevboss conversation** only learns the new verbs at its next conversation; the digest does not
  depend on it.

### Codex continuation — November 10, 2026

This section supersedes the earlier “left / untested” notes where explicitly covered below.

- Mixed mail/result batches now parse the entire batch, including batches containing only session results.
  Generated lines retain up to 220 characters, matching the prompt, rather than cutting them at 120.
- Model-written question buttons carry a fingerprint of their question and choices. A stale button is refused
  even if the same session is waiting on a different question. Late model answers cannot annotate a newer question.
  Choices still go only to that session; no live user session was answered during verification.
- Model budget is reserved after asynchronous preparation. “More” rechecks the current route after reading repo
  facts, uses its own mode rather than mutating the loop's mode, and shares each mode's persisted daily cap.
- Recent Git commits enter without a model: at most 12 commits per active local repo, 12 repos per pass, four-day
  horizon, every four minutes. Commit identities persist across restarts. Newly proposed auto tasks leave a
  history event as well as their live accept/refuse card.
- Vite writes `dist/build.json` with the commit and build time. The running server records that served build once
  per commit as a deployment event. This covers this weevils instance; deployments of other projects are not
  inferred from a commit message or an unverified session claim.
- The folded preview is 42dvh (formerly 34dvh), with less padding above the logo. The open boss thread uses a
  portal outside the transformed home stack, the same viewport and word row geometry as the for-you page.
  The composer retains voice input while the large logo is hidden in full screen. The stream overlays the thread
  when switching, and returning to the boss closes the stream.

Verification: full `npm run check`; regression cases for zero-mail and mixed batches, relay routing and persisted
counts, route changes during fact loading, competing requests for the last budget slot, stale questions and session
routing, and deployment identity across restart. Real Codex generations were reviewed against two recent session
reports and two real attention messages: one trust question with two choices, one non-question. Generated lines
were checked again after the 220-character fix. These were read-only probes, not replies to those sessions.
Chromium desktop (1280×800) and mobile (390×844) checks run against an isolated demo server with its own HOME,
tmux socket and ports (4291/4292), without production credentials. Screenshots and frame checks cover folded,
boss full screen, stream full screen and both switches; no JavaScript errors. Actual iPhone/Safari audio,
keyboard and swipe behaviour still require a device check. Review artifacts are temporary under `/tmp/foryou/`.


### Locale preserves the feed (2026-11-11)

The selected app locale changes presentation, never membership. Recorded IDs, timestamps, read/dismissed states, registered media and action destinations remain authoritative and unchanged. Original wording stays in `foryou.json`; `foryou.json.translations.json` keeps source revisions and validated French/English variants. The UI labels pending/unavailable translations and offers original wording. Mail bodies and quoted user words remain originals; project proper names are protected.

Translation work runs through the existing curator budget/provider/backoff, in batches of up to eight cards, without publishing items or synthesizing speech. Changed source text creates a new cache revision; an answer for an earlier source cannot overwrite it. Presentation variants never replace server-side action instructions. Switching locale during an HTTP request discards the stale response and requests the current locale. Existing editorial-notification and no-automatic-voice policies remain in force.
