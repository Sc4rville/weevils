# Themes

The theme line in the settings band (`~ … theme`) cycles through `THEMES` in `src/ui/app-context.tsx`. This file
records every theme, the idea behind it, and what is still free, so each new theme takes a direction nobody took yet.

## Adding a theme: the checklist

A theme is a `:root[data-theme='<id>']` block in `src/styles.css` (ink, logo filter, top/bottom bands, devil, calm,
working star `--fluo`, the 16 project slots `--p0…--p15`, voice logo `--anim-*`, `--mix`, `--dl`), plus:

- `src/ui/app-context.tsx`: `Theme`, `THEMES` (selector order), `THEME_COLOR` (hex of `--agent`, the iOS status bar);
- `src/i18n/bands.ts`: the label in fr and en;
- `src/styles.css`: `--auto-fluo` (AutoMark), `--alert`; `src/ui/h24.css`: `--automated-ink`; `src/ui/infra.css`:
  `--warn`/`--crit` when the defaults clash; `src/ui/foryou.css`: `--fy-ok`, `--fy-who-*`, `--fy-g1…4` when needed;
- a **dark** theme also joins every `[data-theme='dark']` rule (`.msg.orch.ext`, `.peek-item.orch.ext`, `.wv-flash`,
  `.hint`, `::highlight(wv-ask)`, `--warn`/`--crit`): the defaults assume a light theme;
- `shared/link-colors.ts`: the theme's grounds (agent band, 16 slots, h24, devil, calm) so living links get a shade
  that reads on it; a dark theme also goes in `LIGHT_TEXT`;
- tests: add the id to the theme lists in the tests (`grep -rn "'graphite'" src test`) and to `ADDED` in
  `test/theme-contrast.test.ts` (ink ≥ 6:1, working star, AutoMark and 24/7 title ≥ 3:1 on every band and sub-band,
  white on alert ≥ 3.5:1, project slots ≥ 2 apart at ΔOK ≥ 0.05); `test/logo-palette.test.ts` checks the logo and the
  recording colour;
- project colours are slots, not hues: a project keeps its slot in every theme, only the slot's colour changes. Keep
  slots ordered (neighbours close, slots ≥ 2 apart distinct): the For you cards and feed bands rely on it.

## The themes

| id | fr / en | kind | idea | project slots | what moves |
|---|---|---|---|---|---|
| `light` | clair / light | light | vivid, black text | full rainbow, L 0.80 | green star, magenta AutoMark |
| `dark` | sombre / dark | dark | deep but warm, white text | full rainbow, L 0.44 | neon green, pink |
| `zen` | zen / zen | light | paper, sand, stone; reading | full rainbow, earthy pastel L 0.84 C 0.05 | muted green, plum |
| `graphite` | graphite / graphite | light | all greys, one blue for what moves | no hue: 16 grey steps | one blue for everything |
| `desert` | désert / desert | light | late-afternoon desert: terracotta top, sage 24/7, sand calm band, umber ink | **powdered earth** sage → ochre → terracotta → clay rose → mauve (180° arc, chroma 0.065: the first *dusty* palette), 4 steps | turquoise-jewel star, cochineal-red AutoMark, burnt-sienna 24/7 title |
| `synthwave` | synthwave / synthwave | dark | 80s neon night: violet-black top, magenta horizon 24/7, pale-pink ink | **retro sun** violet → magenta → pink → coral → orange → yellow (145° arc through red), 4 neon intensities | grid-cyan star, neon-pink AutoMark, sun-yellow 24/7 title |

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

## Directions not taken yet (ideas for the next runs)

- **High contrast / accessibility**: pure black and white bands with thick separators, AAA text everywhere.
- **Vaporwave / pastel dark**: a dark theme with candy-pastel slots (synthwave is saturated neon).
- **Forest day / botanical**: a light green-dominant theme (no light theme centres on greens yet).
- **Newsprint / ink wash**: grey paper, sumi-ink black, one red seal.
- **Seasonal / time of day**: a theme that follows the clock (dawn → noon → dusk → night) needs a product decision first.
