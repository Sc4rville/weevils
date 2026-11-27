# Themes

The theme line in the settings band (`~ … theme`) cycles through `THEMES` in `src/ui/app-context.tsx`. This file
records every theme, the idea behind it, and what is still free, so each new theme takes a direction nobody took yet.

## Adding a theme: the checklist

A theme is a `:root[data-theme='<id>']` block in `src/styles.css` (ink, logo filter, top/bottom bands, devil, calm,
working star `--fluo`, the 16 project slots `--p0…--p15`, voice logo `--anim-*`, `--mix`, `--dl`), plus:

- `src/ui/app-context.tsx`: `Theme`, `THEMES` (selector order), `THEME_COLOR` (hex of `--agent`, the iOS status bar);
- `src/i18n/bands.ts`: the label in fr and en;
- `src/styles.css`: `--auto-fluo` (AutoMark); never a red `--alert` (2026-11-26: a state is never an alarm, a paused
  session or a failure reads in the theme's own colours; red is only `--destroy`, for something truly destroyed);
  `src/ui/h24.css`: `--automated-ink`; `src/ui/infra.css`:
  `--warn`/`--crit` when the defaults clash; `src/ui/foryou.css`: `--fy-ok`, `--fy-who-*`, `--fy-g1…4` when needed;
- a **dark** theme also joins every `[data-theme='dark']` rule (`.msg.orch.ext`, `.peek-item.orch.ext`, `.wv-flash`,
  `.hint`, `::highlight(wv-ask)`, `.fy-sheet-back`, `--warn`/`--crit`; `grep -rn "data-theme='synthwave'" src` lists them):
  the defaults assume a light theme;
- the server needs nothing: it keeps any well-formed theme id (`server/theme-pref.ts`), each app applies only the
  themes it knows;
- `shared/link-colors.ts`: the theme's grounds (agent band, 16 slots, h24, devil, calm) so living links get a shade
  that reads on it; a dark theme also goes in `LIGHT_TEXT`;
- `next/src/next.css`: a light theme belongs in the `.nx-fx-busy` list; outside the theme kinds, so a nightly run
  leaves it to the person (it would stop the run landing by itself);
- tests: add the id to the theme lists in the tests (`grep -rn "'graphite'" src test`) and to `ADDED` in
  `test/theme-contrast.test.ts` (ink ≥ 6:1, working star, AutoMark and 24/7 title ≥ 3:1 on every band and sub-band,
  no `--alert` of its own, project slots ≥ 2 apart at ΔOK ≥ 0.05); `test/logo-palette.test.ts` checks the logo and the
  recording colour;
- project colours are slots, not hues: a project keeps its slot in every theme, only the slot's colour changes. Keep
  slots ordered (neighbours close, slots ≥ 2 apart distinct): the For you cards and feed bands rely on it.

- **texture** (optional, encouraged): a theme can lay a matter over the whole window with `--texture` (one or more CSS
  images: gradients, `repeating-*-gradient`, `conic-gradient`, inline SVG as a `data:` URI with `feTurbulence` for
  grain), `--texture-size`, `--texture-position`, `--texture-blend` (a `mix-blend-mode`: normal, multiply, screen,
  overlay, soft-light, darken, lighten) and `--texture-opacity` (≤ 0.12). It sits over everything (`html::after` in
  `src/styles.css`), never takes a tap, fetches nothing; `test/theme-contrast.test.ts` holds the bounds. Seen in
  coastal (sand grain and tide ripples, multiply) and deco (gold fan scales in offset rows);
- landing: a theme run's branch merges into main by itself once the checks pass, and weevils then posts "new theme X
  is in your selector" (docs/automations/auto-merge.md). The run's own post never says the theme is live.

## The bar for a new theme (from the person, 2026-11-23)

« More creative, take risks, play with texture. » A new theme is not a new palette on the same flat bands: it is a
world. Each run picks at least one bold move and says which:

- **a texture** that carries the idea (paper fibre, risograph halftone, CRT scanlines, linen, terrazzo, marble veins,
  brushed metal, blueprint grid, film grain, knit, stained glass leading…);
- **a typeface** from what the phone already has (`--font`: a system stack such as `ui-serif, Georgia, serif`,
  `ui-monospace, Menlo, monospace`, `"Avenir Next", Futura, ui-sans-serif`, `"American Typewriter", Courier, monospace`),
  always with a generic family last; never a downloaded font;
- **a palette nobody would expect** (clashing pairs, near-monochrome with one scream, two-tone duotone).

Risks are welcome; only the measured floor is not negotiable: the contrast test, slots ≥ 2 apart distinct, the
texture bounds, both languages, phone and desktop. Each run lands its themes on main by itself (no question to the
person, no branch left waiting): keep the worktree clean (screenshots and scratch files outside it, in `/tmp`), commit
everything the themes need, and the checks decide.

## The themes

| id | fr / en | kind | idea | project slots | what moves |
|---|---|---|---|---|---|
| `light` | clair / light | light | vivid, black text | full rainbow, L 0.80 | green star, magenta AutoMark |
| `dark` | sombre / dark | dark | deep but warm, white text | full rainbow, L 0.44 | neon green, pink |
| `zen` | zen / zen | light | paper, sand, stone; reading | full rainbow, earthy pastel L 0.84 C 0.05 | muted green, plum |
| `graphite` | graphite / graphite | light | all greys, one blue for what moves | no hue: 16 grey steps | one blue for everything |
| `desert` | désert / desert | light | late-afternoon desert: terracotta top, sage 24/7, sand calm band, umber ink | **powdered earth** sage → ochre → terracotta → clay rose → mauve (180° arc, chroma 0.065: the first *dusty* palette), 4 steps | turquoise-jewel star, cochineal-red AutoMark, burnt-sienna 24/7 title |
| `synthwave` | synthwave / synthwave | dark | 80s neon night: violet-black top, magenta horizon 24/7, pale-pink ink | **retro sun** violet → magenta → pink → coral → orange → yellow (145° arc through red), 4 neon intensities | grid-cyan star, neon-pink AutoMark, sun-yellow 24/7 title |
| `botanical` | botanique / botanical | light | herbarium plate: leaf-green top, petal-pink 24/7, cream paper calm band, forest-floor ink | **greens** straw → leaf → fern → eucalyptus → sky (140° arc centred on green, chroma 0.085), 4 steps: the first light theme built on greens | flower-fuchsia star, iris-violet AutoMark, berry 24/7 title |
| `coastal` | littoral / coastal | light | a day at the seaside: surf-blue top, sand 24/7, sea-spray calm band, navy ink; **texture** wet-sand grain and tide ripples | **blues** sea foam → turquoise → azure → cornflower → lavender (160° arc centred on blue, chroma 0.07), 4 steps: the first light theme centred on blues | buoy-red star, kelp-green AutoMark, harbour-blue 24/7 title |
| `deco` | art déco / art deco | dark | black lacquer and gold leaf: gilded-black top, emerald 24/7, oxblood devil band, cream ink; **texture** gold fan scales | **metals and patinas** verdigris → malachite → brass → gold → bronze → copper (140° arc, chroma 0.085), 4 steps | gold-leaf star, jade AutoMark, champagne 24/7 title |
| `vaporwave` | vaporwave / vaporwave | dark | pastel dusk of an empty mall: dusk-teal top, powder-pink 24/7, deep indigo calm band, lavender-white ink | **muted pastels** teal → cyan → periwinkle → lavender → orchid → pink (180° cool-to-pink arc, chroma 0.075: dusty, not neon), 4 steps | mint star, bubblegum-pink AutoMark, peach 24/7 title |
| `carbon` | papier carbone / carbon copy | light | a multi-part order pad typed on a machine: white original top, canary-copy 24/7, pink-copy devil band, green-copy reply, cream calm band; **ink in carbon blue-violet** `#1d2470`, not black; **typeface** monospace (`ui-monospace`, Menlo…); **texture** paper fibre tinted carbon blue and two soft carbon smudges (multiply, 0.12) | **the copies of a form pad** goldenrod → canary → green → blue → lilac → pink (280° arc, chroma 0.055), 4 steps | rubber-stamp red star, ledger-green AutoMark, stamp-red 24/7 title |
| `chalkboard` | tableau noir / chalkboard | dark | a classroom slate wiped in a hurry: slate green-black top, chalk-tray wood 24/7, red-chalk devil band, deep slate calm band, chalk-white ink; **typeface** Chalkboard SE on iPhone and Mac (rounded, then the system sans elsewhere); **texture** chalk dust and two eraser smears (screen, 0.12) | **coloured chalks smudged on slate**, the whole circle at low chroma (0.055), 4 depths | yellow-chalk star, blue-chalk AutoMark, pink-chalk 24/7 title |
| `atlas` | atlas / atlas | light | a hand-coloured plate from an old atlas: vellum top, sea-green 24/7, boundary-rose devil band, lowland-green reply, pale vellum calm band, sepia ink; **typeface** the phone's serif (`ui-serif`: New York on iPhone and Mac, Georgia elsewhere), the first serif theme; **texture** contour lines of four hills on two tiles of different sizes, and the graticule of meridians and parallels (multiply, 0.12) | **hypsometric tints**, sea → plains → hills → mountains → peaks: cyan-green → green → straw → ochre → brown → rose-mauve (210° arc descending, chroma 0.06), 4 steps | route-carmine star, Prussian-blue AutoMark, burnt-sienna 24/7 title |
| `crt` | cathodique / CRT | dark | an amber monochrome monitor in a dark room: warm near-black bands, amber-glow 24/7, red devil band; **ink in P3 amber** `#ffdca0`, the first dark theme whose text is a colour; **texture** scanlines (one line in three), the red-green-blue phosphor grille and the tube's dark corners (normal, 0.12) | **a badly tuned screen**, amber → red → violet → blue → cyan (280° arc, chroma 0.075), 4 dim depths | phosphor-green star (the one scream), cyan AutoMark, hot-amber 24/7 title |
| `terrazzo` | terrazzo / terrazzo | light | a 1980s Milanese terrazzo floor: **mustard top and lilac 24/7 that clash on purpose**, tomato devil band, mint reply, warm plaster calm band, aubergine ink `#1a0f1e`; **typeface** the phone's rounded sans (`ui-rounded`: SF Pro Rounded on Apple devices), the first rounded theme; **texture** stone chips, irregular polygons in seven stones on two tiles of different sizes (multiply, 0.12) | **marble chips**, the whole circle from Verona red, 4 steps (chroma 0.085) | cobalt star, Prato-green AutoMark, brick 24/7 title |
| `woodblock` | estampe / woodblock | dark | a Japanese woodblock print at night: Prussian-blue top (the *bero-ai* of the waves), block-wood 24/7, seal-vermilion devil band, verdigris reply, deep indigo calm band, washi-cream ink `#f8eedb`; **typeface** the phone's mincho (Hiragino Mincho on Apple devices, then the system serif); **texture** the grain of the carved block, noise stretched 22:1 horizontally, which reads as wood and as water, plus a *bokashi* glow rising from the bottom (screen, 0.12) | **the print's pigments**, indigo → blue → green → ochre → vermilion → safflower (270° arc descending, chroma 0.07), 4 depths | persimmon star, wave-foam AutoMark, safflower-pink 24/7 title |
| `departures` | départs / departures | dark | a station's split-flap board at night: **enamel black with no hue at all** on top (the first truly black dark theme), platform-sign blue 24/7, closed-signal red devil band, clear-signal green reply, deeper black calm band, flap-white ink `#f6f2e3`; **typeface** the phone's condensed sans (Avenir Next Condensed on Apple devices, Roboto Condensed on Android, Arial Narrow elsewhere), the first condensed theme; **texture** the flaps themselves: rows of half-flaps lit from above, a hinge through each row, columns 26px apart (normal, 0.12) | **the lines of a network map by night**, the whole circle from blue, descending (chroma 0.065), 4 depths | flap-yellow star, « on time » green AutoMark, header-yellow 24/7 title |
| `newsprint` | papier journal / newsprint | light | the front page of a daily: warm newsprint grey top, financial-pages salmon 24/7, faded stop-press red devil band, racing-sheet green reply, paler paper calm band, press-black ink `#14110e`; **near-monochrome with one scream**, the masthead red, kept for what works; **typeface** the newspapers' roman (Times New Roman, then the system serif); **texture** the first halftone: a 45° dot screen that fades out in patches, pulp grain, and the paper's fold across the middle of the window (multiply, 0.12) | **the tinted papers of a kiosk**, pink → salmon → buff → yellow → green → blue → lilac (300° arc, chroma 0.045: the palest slots of all), 4 steps | masthead-red star, crossword-ballpoint blue AutoMark, headline-black 24/7 title (the first 24/7 title with no colour) |

## Log

### Note (2026-11-21): what shipped

The nightly runs of 2026-11-14 to 11-17 built sunset, abyss, riso, moss, candy, phosphor, bauhaus and blueprint on an
older line of history that never reached main; their entries below record the ideas, not shipped themes. desert and
synthwave are the first nightly themes on main. Porting one of the earlier eight means taking its blocks from that
log entry's branch and following the checklist above.

### 2026-11-14 — sunset, abyss

First nightly run. The four existing themes all use either the full rainbow (light, dark, zen) or no hue at all
(graphite). Both new themes take a third road: an **analogous palette**, one arc of the colour wheel, with the
lightness alternating over three steps so that slots stay apart. One light, one dark.

- **sunset** (couchant): rose dusk band on top (`#E189C5`), golden 24/7 band at the bottom, so the page reads as a sky
  going down to the horizon. Plum ink `#240e2c`. Projects in warm colours only. The working star turns deep teal, the
  one cool note, so it still jumps out of a warm page. AutoMark and the "automated" title in evening indigo. Logo:
  sepia-tinted dark grey. Alert and warning one step deeper so they stay distinct from the coral bands.
- **abyss** (abysses): deep indigo top band (`#26245E`), teal floor at the bottom, pale sea-foam ink `#e6fbff`.
  Projects in cold colours only, at three depths. The working star glows cyan-green like plankton; AutoMark and the
  "automated" title glow jellyfish pink. Logo: light, like dark. Behaves as a dark theme everywhere (hints, scrim,
  flashes, outside authors' bubbles brought to its depth).

Checked: contrast tests above, the whole suite, typecheck and i18n; screenshots of home, footer theme line and For
you on desktop (1280×900) and mobile (390×844), in en and fr.

### 2026-11-15 — riso, moss

Second nightly run. Two directions from the list below.

- **riso**: the print-shop look. Pink top band (`#FF8FB8`), yellow 24/7, cream calm band, ink `#0f1040` like a blue
  print. Projects only take the mixes of the three riso inks (blue, pink, yellow), so green never appears in a
  project; it is kept for the working star (deep riso green). AutoMark and "automated" in blue ink. For you gradient
  walks blue → pink → yellow.
- **moss**: the warm dark counterpart of abyss. Moss-green top (`#2E3A1F`), bark-brown 24/7 band, cream ink `#fbf8ea`.
  Projects from fir green through olive and ochre to rust and wine, three depths. Firefly-yellow star, amanita-red
  AutoMark. Joins every dark-theme rule like abyss.

Checked: contrast tests (riso needed a darker ink and star to clear 6:1 and 3:1; moss a wider arc, 165°, to keep
slots apart), front-end suite, typecheck, i18n; swatch screenshots of the bands at 1280×900 and 390×844. Not checked:
full-app screenshots (logging into the live app needs the access code, which a nightly run must not read).

### 2026-11-16 — candy, phosphor

Third nightly run. Two directions from the list below, one light, one dark.

- **candy** (bonbon): the first *pastel pop* theme. Top band almost white (`#FBEFF6`), mint 24/7, pale pink calm
  band, aubergine ink `#2a0a3a`. Projects in bright pastels from mint to peach over three sugar levels (lighter and
  more saturated than light or zen). Star in strong mint, AutoMark in barley-sugar magenta. For you gradient mint →
  sky → pink → peach.
- **phosphor** (phosphore): the terminal look. Near-black green bands (`#0E1A10`), CRT-green ink `#d4ffcc`. Projects
  follow the three classic phosphors (P4 blue-white, P1 green, P3 amber) over **four** scan intensities (the first
  theme with four lightness steps, needed to keep a 150° arc apart). White-amber star, cyan AutoMark. Joins every
  dark-theme rule.

Checked: contrast tests (candy needed a deeper AutoMark, phosphor a lighter ink to clear 6:1), whole front-end suite,
typecheck, i18n; swatch screenshots at 1280×900 and 390×844. Not checked: full-app screenshots (access code).
Unrelated: two `server/optimizers-sessions` tests fail inside the automation worktree (task sessions), untouched here.

### 2026-11-17 — bauhaus, blueprint

Fourth nightly run. Two directions from the list below, one light, one dark.

- **bauhaus**: flat primaries. Yellow top band (`#F2C72E`), pale blue 24/7, red-tinted devil band, cream calm band,
  black ink. Projects only take the primaries and their mixes (blue → violet → red → orange → yellow), three lightness
  steps; green never appears. Cobalt star, vermilion AutoMark, brick 24/7 title. For you gradient blue → red → yellow.
- **blueprint** (plan): the architect's print. Prussian-blue top (`#0B2D5C`), white ink. Projects in tracing-paper
  blues over four line weights. White-cyan star, orange correction-pencil AutoMark and 24/7 title (the one warm
  note). Joins every dark-theme rule.

Checked: contrast tests (bauhaus needed a deeper AutoMark; blueprint a 130° arc and chroma 0.1 to keep slots apart),
whole suite (same two unrelated `server/optimizers-sessions` failures as last run), typecheck, i18n. Not checked:
screenshots (no browser driver in the worktree, and the live app needs the access code).

### 2026-11-21 — desert, synthwave

Fifth nightly run. Two directions from the list below, one light, one dark.

- **desert** (désert): the dusty counterpart of sunset. Terracotta top band (`#D9A07E`), pale sage 24/7, sand calm
  band, umber ink `#1f120a`. Projects in low-chroma (0.065) powdered earth tones over a 180° arc and **four** steps,
  the first light theme with four (low chroma needs the extra step to keep slots apart). Turquoise star (darkened to
  L 0.37 to clear 3:1 on the deepest slot), cochineal AutoMark. For you gradient sage → ochre → terracotta → mauve.
- **synthwave**: violet-black top (`#1E0B3A`), magenta horizon 24/7, pale-pink ink. Projects walk the retro-sun
  gradient from violet through pink and coral to yellow (warm, unlike abyss's cold arc on similar dark bands), four
  neon intensities. Cyan grid star, neon-pink AutoMark, sun-yellow 24/7 title. Joins every dark-theme rule.

Checked: contrast and logo tests (desert needed a deeper ink, star and AutoMark), whole suite (pre-existing failures
only: two `server/optimizers-sessions`, one `server/background`, the same on the untouched branch), typecheck, i18n;
real-app screenshots (onboarding) in en and fr plus slot swatches at 1280×900 and 390×844, from a throwaway server in
an empty home. Lesson for next runs: start that throwaway server with `env -i` (clean environment), or it inherits the
machine's mail bridge settings and reads the real inbox.

### 2026-11-22 — botanical, vaporwave

Sixth nightly run. Two directions from the list below, one light, one dark.

- **botanical** (botanique): a herbarium plate. Leaf-green top band (`#A6D2A7`), petal-pink 24/7, cream paper calm
  band, rose-hip devil band, forest-floor ink `#0c1f10`. Projects only in greens and their neighbours, from straw
  through leaf and fern to eucalyptus and a pale sky (140° arc, four steps, chroma 0.085). The flowers carry what
  moves: fuchsia working star, iris-violet AutoMark, berry 24/7 title. For you gradient straw → leaf → fern →
  eucalyptus. First try started the arc at hue 80, which read as peach on the first project: moved to 100 (straw).
- **vaporwave**: the pastel answer to synthwave. Dusk-teal top band (`#0D3343`), powder-pink 24/7, deep indigo calm
  band, lavender-white ink `#f7f3ff`. Projects in muted pastels on a cool-to-pink arc (teal → periwinkle → lavender →
  orchid → pink), four depths, low chroma, where synthwave is saturated and warm. Mint star, bubblegum-pink AutoMark,
  peach 24/7 title. Joins every dark-theme rule.

Checked: contrast, logo and link-colour tests (both passed at the first values), whole front-end suite (src, test,
shared: all green), typecheck, i18n; real-app screenshots in en and fr at 1280×900 and 390×844 plus slot swatches,
from a throwaway server (`env -i`, empty home, its own access code, own ports for the app and the hooks). Not
touched: `server/` (its git-heavy tests fail inside the automation worktree, as on the untouched branch). Tooling
note for next runs: no Docker for this user and no `~/.local/share/weevils/capture`; playwright-core from another
project with `executablePath` set to the cached `chromium_headless_shell` works.

### 2026-11-23 — coastal, deco

Seventh nightly run. Two directions from the list below, one light, one dark.

- **coastal** (littoral): a day at the seaside. Surf-blue top band (`#9FD0E8`), sand 24/7, coral devil band, foam
  devil-reply, sea-spray calm band, navy ink `#030d22`. Projects in blues only, from sea foam through turquoise, azure
  and cornflower to lavender (160° arc, four steps, chroma 0.07). Pale blues leave the sRGB gamut fast: chroma 0.09 or
  a top step above L 0.86 clipped, so the arc is wide and the chroma low. Buoy-red star, kelp-green AutoMark,
  harbour-blue 24/7 title. For you gradient sea foam → turquoise → azure → lavender.
- **deco** (art déco): black lacquer and gold leaf. Gilded-black top band (`oklch(0.2 0.028 85)`, `#1C1507`), emerald
  24/7, oxblood devil band, bronze devil-reply, cream ink `#f8f0dc`. Projects walk the metals and their patinas
  (verdigris → brass → gold → bronze → copper), four depths: synthwave is neon and runs violet → yellow, deco is
  green → copper and low-key. Gold star, jade AutoMark, champagne 24/7 title. Joins every dark-theme rule.

Checked: contrast, logo and link-colour tests, whole front-end suite (src, test, shared: all green), typecheck, i18n,
public guard; real-app screenshots (onboarding, For you, menu with the theme line) in en and fr at 1280×900 and
390×844 plus slot swatches, from a throwaway server (`env -i`, empty home, own ports). Not touched: `server/`.

Lesson for next runs (it cost a round): the build (LightningCSS) turns every `oklch()` into `lab()`, and Chrome then
reads a colour of chroma under about 0.02 as hueless when a rule derives a shade from it (`oklch(from var(--c) …)`,
`.tone` sub-bands, the composer): the hue becomes 0 and a warm near-black turns mauve. Keep `--agent` and `--calm` at
chroma ≥ 0.02 (or exactly 0, like graphite), and check the composer's computed colour in the browser. desert's and
botanical's calm bands (chroma 0.016) take a faint pink tint in that one derived shade; untouched here.

### 2026-11-23 (later) — textures

The person asked for bolder themes with texture, landing by themselves. Added the texture layer (`--texture*`, above),
its bounds in the contrast test, and gave the two newest themes one each: coastal a wet-sand grain with tide ripples
(two `data:` SVGs, multiply, 0.12), deco a gold fan-scale pattern (two offset radial gradients, 0.1). Also fixed why
the coastal/deco run did not land by itself: a `shots-tmp/` folder an earlier run left in the worktree counted as
uncommitted work (`server/auto-merge.ts` now looks at tracked files only), and the push of the branch, refused as
non-fast-forward, hid the « Land it » line (now offered either way).

### 2026-11-24 — carbon, chalkboard

Eighth nightly run, the first under the bolder bar: both themes change the typeface, both carry a texture, and the
first one colours the text itself.

- **carbon** (papier carbone): the order pad with its carbon copies. The bold moves: the text is the blue-violet of a
  carbon copy (`#1d2470`), the first theme whose ink is a colour rather than a near-black; the whole app is set in the
  phone's monospace (the first theme with its own `--font`); a texture of paper fibre (stretched `feTurbulence`,
  horizontal) tinted carbon blue, with two large soft carbon smudges. The bands are the sheets of the pad (white
  original, canary, pink, green copies); projects take the copies' tints over a 280° arc, four steps. Rubber-stamp red
  star, ledger-green AutoMark. First try put the weevboss band at `#ebf7ff` (chroma 0.019): the composer, derived from
  it, turned pink in Chrome (the low-chroma lesson again); `#e2f7ff` (chroma 0.03) fixed it.
- **chalkboard** (tableau noir): the classroom slate. Bold moves: the typeface `Chalkboard SE` on Apple devices (a
  chalk hand; elsewhere the rounded or system sans, no download), and chalk dust over everything (white
  `feTurbulence` speckles, screen) with two pale eraser smears. Slate green-black bands, chalk-tray wood 24/7, chalk
  white ink; projects are coloured chalks smudged into the slate, the whole circle at low chroma, four depths. Yellow
  chalk star, blue chalk AutoMark, pink chalk 24/7 title. Joins every dark-theme rule.

Left for the person: the next interface has one theme list of its own in `next/src/next.css` (`.nx-fx-busy`, a
darker hue for a busy machine's icon on light themes). carbon belongs in it, but a file outside the theme kinds keeps a
run from landing by itself (`server/auto-merge.ts`), so it is not in this run: there carbon's busy icon stays at the
default, lighter hue. Checked: contrast, logo and link-colour tests (passed at the first values), whole front-end suite (failures
only in `server/` git-heavy tests and `test/macos-launchd`, as on the untouched branch), typecheck, i18n; screenshots of
weevboss, For you, the menu and the classic screen in en and fr at 1280×900 and 390×844, plus slot swatches, from a
throwaway server (`env -i`, empty home, own ports, a few fake Claude Code projects so the bands have colours). Not
seen: Chalkboard SE itself (the run's browser is Linux; iPhone and Mac have it). Tooling note: this worktree's
`node_modules` had fallen behind (`modern-screenshot` missing, typecheck failing): `NODE_ENV=production` is set here,
so reinstall with `npm ci --include=dev`. The next interface builds apart: `vite build -c next/vite.config.ts`.

### 2026-11-25 — atlas, crt

Ninth nightly run. One light, one dark, each with more than one bold move.

- **atlas**: an old atlas plate, engraved then coloured by hand. Bold moves: the first serif theme (`ui-serif`, so New
  York on Apple devices, Georgia or Noto Serif elsewhere, nothing downloaded); a texture that makes the window a map,
  contour lines of four hills in sepia over the graticule (meridians and parallels every 132px); and slots that are
  the **hypsometric tints** of a relief map, ordered by altitude from the sea to the peaks, so a project's slot reads
  as a height. Vellum top band, sea-green 24/7, sepia ink `#1c1206`. Route-carmine star, Prussian-blue AutoMark,
  burnt-sienna 24/7 title (coastal's buoy-red / kelp / harbour-blue trio avoided on purpose). First try used one
  360px contour tile: on desktop it repeated like wallpaper; now two tiles of different sizes (560×500, 430×610,
  offset), each drawn wrapping across its edges with `<use>` so it stays one 8 KB `data:` SVG.
- **crt** (cathodique): an amber monochrome monitor. Bold moves: amber text on warm black (the first dark theme with
  a coloured ink; carbon did it on light); a three-layer texture, scanlines, the RGB phosphor grille as 1px vertical
  stripes, and a vignette for the tube's corners; a palette of dim, slightly wrong colours walking amber → red →
  violet → blue → cyan, with phosphor green kept for the working star alone. System sans kept: carbon owns
  monospace. Joins every dark-theme rule. The slots are darker than other dark themes' (L 0.2–0.35): amber ink is
  less bright than white and needs them to clear 6:1.

Checked: contrast, slot, texture, logo and link-colour tests (passed at the first values), typecheck, i18n, the
front-end suite (src, test, shared: only `test/macos-launchd` fails, as before); `server/` git-heavy tests fail inside
the automation worktree as on the untouched branch. Screenshots of weevboss, For you, the menu and slot swatches in en
and fr at 1280×900 and 390×844 from a throwaway server (`env -i`, empty home, own ports 4391/4392, six fake Claude
Code projects). Not seen: New York itself (Linux browser; it falls back to the system serif). For you stays empty in a
blank home: its cards' colours come from the slots, seen in the swatches.

Note for the person: carbon and chalkboard (2026-11-24) had not reached main when this run started; this branch
carries them too. A theme that touches `shared/link-colors.ts` makes the landing run the whole test suite
(`touchesServer`), and that suite's git-heavy `server/` tests fail inside the automation worktree: if this run does
not land either, that is the likely reason. Like carbon, atlas belongs in the `.nx-fx-busy` list of
`next/src/next.css` (a light theme), left to the person for the same reason.

### 2026-11-26 — terrazzo, woodblock

Tenth nightly run. One light, one dark, each with three bold moves (typeface, texture, palette).

- **terrazzo**: a Memphis-era terrazzo floor. The texture is the idea: chips of seven stones (Verona red, Prato green,
  black, ochre, lilac, coral, blue) as irregular polygons, generated with a seed, each drawn again across the tile's
  edge it overlaps so nothing is cut, on two tiles (380×330 and 270×310, offset) so the floor does not read as a
  grid. The bands clash on purpose, mustard top against lilac 24/7, tomato devil band against mint reply. First
  rounded theme (`ui-rounded`; elsewhere the system sans, nothing downloaded). The AutoMark needed L 0.40 (0.42 gave
  2.9:1 on the deepest slot).
- **woodblock** (estampe): a night print in the manner of Hokusai. The texture is the grain of the cherry-wood block
  showing through the flat colour, a `feTurbulence` stretched to `0.004 0.09` with light veins, in screen: on the blue
  bands it also reads as the lines of the sea. A faint *bokashi* (a gradient glow from the bottom) makes the page a
  print's sky. First mincho typeface (Hiragino Mincho, Yu Mincho, then the system serif; atlas's `ui-serif` is a
  different face on Apple devices). Slots are the print's pigments, cool to warm. Joins every dark-theme rule.

Checked: contrast, slot, texture, logo and link-colour tests (woodblock at the first values, terrazzo after the
AutoMark fix), typecheck, i18n, the front-end suite (only `test/macos-launchd` fails, as before; `server/` git-heavy
tests fail inside the automation worktree as before). Screenshots of weevboss, For you, the menu and slot swatches in
en and fr at 1280×900 and 390×844 from a throwaway server (`env -i`, empty home with its own access code written
beforehand, ports 4391/4392, six fake Claude Code projects). Lesson: the theme is shared by the server (POST
`/api/theme`, carried back by the snapshot), so a screenshot script must POST the theme it shows, or the last one
picked wins over localStorage. Not seen: SF Pro Rounded and Hiragino Mincho themselves (Linux browser).

Note for the person: carbon, chalkboard, atlas and crt have still not reached main; this branch carries them and these
two. `shared/link-colors.ts` makes the landing run the whole suite (`touchesServer`), and its git-heavy `server/` tests
fail inside the automation worktree: that is very likely what keeps all six waiting. terrazzo belongs in the
`.nx-fx-busy` list of `next/src/next.css` (a light theme), left to the person like carbon and atlas.

### 2026-11-27 — departures, newsprint

Eleventh nightly run. One dark, one light, each with three bold moves (typeface, texture, palette), both from the
list below (condensed typefaces, newsprint).

- **departures** (départs): the split-flap board of a station at night. The texture is the object itself: three
  gradients and no SVG draw rows of half-flaps lit from above, the hinge through the middle of each row and the gaps
  between columns, so the whole window is a wall of flaps and every band, whatever its colour, is made of them. First
  condensed typeface (Avenir Next Condensed, Roboto Condensed through Android's `sans-serif-condensed`, Arial Narrow;
  elsewhere the system sans, nothing downloaded). First dark theme whose bands are a true black, chroma exactly 0
  (dark is violet, deco gilded, crt warm): the colour comes only from the slots, the lines of a network map, and from
  the flap yellow of what works. Joins every dark-theme rule.
- **newsprint** (papier journal): the front page of a daily. The first halftone: two offset dot grids make a 45°
  screen, two large white patches on tiles of different sizes erase it in places so it reads as a printed tone
  rather than a wallpaper, a pulp grain lies over it, and a faint shadow line across the middle of the window is the
  paper's fold. Times New Roman, the newspapers' own roman (atlas's `ui-serif` is New York on Apple devices, a
  different face). Near-monochrome: grey paper, black ink, a black 24/7 headline, and one red, the masthead's, for
  the working star alone. The slots are the palest of all themes (chroma 0.045), which needs a 300° arc to keep them
  apart. The star needed L 0.45 (0.48 gave 2.95:1 on the deepest slot).

Checked: contrast, slot, texture, logo and link-colour tests, typecheck, i18n, public guard, the whole front-end
suite (src, test, shared: all green; `test/logo.test.tsx` counts the themes' logo filters, now 18). Screenshots of
weevboss, For you (cards in their project's slot), the menu, the theme line (« départs », « papier journal »,
« departures », « newsprint ») and slot swatches in en and fr at 1280×900 and 390×844, from a throwaway server
(`env -i`, the empty home of the last run, ports 4391/4392). Not seen: the condensed face itself (the run's Linux
browser has none and falls back to the system sans) and Times New Roman (it falls back to Liberation Serif, the same
metrics). Dark yellows and dark cyans leave the sRGB gamut early: departures' slots stay at chroma 0.065 (0.075
clipped five of them).

Note for the person: newsprint belongs in the `.nx-fx-busy` list of `next/src/next.css` (a light theme), left to
the person like carbon and atlas were. This run's worktree was on the branch `feat/theme-textures`, level with main,
not on the `auto/…` branch named in its brief: the work is committed there, without switching branch.

## Directions not taken yet (ideas for the next runs)

- **High contrast / accessibility**: pure black and white bands with thick separators, AAA text everywhere.
- **Candy-pastel dark**: brighter, sugary pastel slots on black (vaporwave stays dusty and low-chroma).
- **Forest night**: a dark green theme (botanical is the day version; moss, never shipped, was its warm cousin).
- **Ink wash**: sumi-ink greys bleeding into wet paper, one red seal (newsprint took the printed page and its halftone).
- **Glacier / arctic**: a near-white icy light theme with one aurora accent (coastal is warm-sand and blues; this would
  be cold and almost monochrome).
- **Lacquer red**: a dark red-lacquer theme (woodblock took the indigo print, deco black and gold).
- **Thermal receipt**: carbon took monospace and coloured ink; a true one-ink receipt (16 slots in one faded hue) does
  not pass the slots ≥ 2 apart rule at low chroma: it needs a hue arc of 200° or more.
- **Serif worlds**: atlas took `ui-serif` for a map, newsprint Times for a daily; a library card catalogue or a
  paperback (Baskerville, Palatino) is free.
- **Geometric typefaces**: departures took the condensed sans; a geometric face (`"Avenir Next"`, Futura, `"Century
  Gothic"`) for a poster or a swimming-pool world is free.
- **Woven and ruled textures**: tartan or twill (crossing translucent stripes), a knit, the Seyès ruling of a French
  school notebook with its red margin, graph paper in orange: all free. Taken so far: grain, ripples, fan scales,
  fibre, chalk dust, contour lines, scanlines, stone chips, wood grain, split flaps, halftone.
- **Stained glass**: jewel colours held by dark leading, on a dark theme.
- **Seasonal / time of day**: a theme that follows the clock (dawn → noon → dusk → night) needs a product decision first.
