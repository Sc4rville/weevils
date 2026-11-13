# Think

Think adds a spatial memory canvas beside For you. Objects retain stable IDs, world coordinates, original text or image bytes, source URLs and explicit relationships. The canvas is private to the existing installation's authenticated users (the existing shared access-code boundary, not separate per-person accounts).

## Implementation stages

The first stage uses React DOM elements with CSS transforms and native textareas. It preserves the app's fonts and palette and avoids a second editor framework, renderer, licence or paid service. Pointer positions are inverted through a single camera transform. Wheel pans; Ctrl/Meta-wheel and two fingers zoom around an anchor. A later move to a specialist canvas library should be driven by measured large-board performance and accessibility needs. The current bounded model allows 2,000 objects; it does not claim unbounded rendering performance.

The authoritative board lives in `think.json` under the installation data directory, written through an fsynced temporary file and atomic rename. A monotonic revision provides compare-and-swap conflict protection. A stale client cannot overwrite another client's changes. The UI retains the losing draft and offers export/reload. Each tab keeps its draft in IndexedDB before attempting a network save. Export includes the original image data, coordinates, text, IDs and relationships; import is validated. Undo/redo currently lasts for the open canvas, while the content and camera survive reload.

The second stage builds viewport evidence: exact world bounds, zoom, dimensions, visible and selected objects, full semantic text even at low zoom, relationships and recent interaction events. Image objects explicitly state that visual content is unavailable. There is no claim of screenshot capture. The context is inspectable before sending through the standard Composer to an explicitly chosen existing session, using the existing durable outbox. Reading or editing never sends requests. Sending a request means accepted for delivery, not executed or completed; the destination transcript remains the source of truth.

AI layout uses the existing provider abstraction and returns coordinate proposals only. IDs and numeric bounds are validated, text/media are never accepted back from the model, and an exact board snapshot guards apply. The preview is visible before apply, can be cancelled, and applying creates one undo step. Pointer contact blocks applying a layout. The ordinary layout preview is a deterministic grid and is not labelled as AI. AI is requested separately from the context panel. No new paid service is introduced.

## Verification and remaining acceptance

Integrated into main and the primary application on 2026-11-13 (code commit 00064a4). The merge retained current media, automation and outbox work. The production build serves the Think entry and layout endpoint; the canvas API returns 401 without authentication. The controlled daemon restart preserved all nine tmux pane IDs and process IDs.

The full integration check passed 1,429 tests, plus typecheck, translation and shell checks. Coverage includes transforms, low-zoom semantic evidence, atomic persistence, corruption refusal, concurrency, offline recovery, normal header entry, native composer submission, frozen retry context, pinch completion, undo/redo and rejection of unexpected model fields. The isolated server also passed real HTTP save/readback and stale-write rejection. Test temporary files use a task-specific cache because the VPS /tmp user quota was exhausted.

A bounded live layout smoke used two synthetic notes and the existing authenticated provider, without copying credentials to isolation. Claude returned a quota failure. The already-authorized automatic Codex relay returned validated positions for both original object IDs in 4.4 seconds. The production route follows the application's existing relay policy. This verifies actual model integration, not screenshot understanding.

Real desktop/mobile rendering, keyboard behavior, the requested screenshot publication and Scarville's acceptance remain outstanding: the PC is offline and no PC browser tool is available in this session. The isolated preview remains active on port 4416; production uses the normal application entry. Do not infer visual acceptance from unit tests or from session status, and do not publish a fabricated screenshot.
