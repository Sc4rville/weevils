# Think

Think adds a spatial memory canvas beside For you. Objects retain stable IDs, world coordinates, original text or image bytes, source URLs and explicit relationships. The canvas is private to the existing installation's authenticated users (the existing shared access-code boundary, not separate per-person accounts).

## Implementation stages

The first stage uses React DOM elements with CSS transforms and native textareas. It preserves the app's fonts and palette and avoids a second editor framework, renderer, licence or paid service. Pointer positions are inverted through a single camera transform. Wheel pans; Ctrl/Meta-wheel and two fingers zoom around an anchor. A later move to a specialist canvas library should be driven by measured large-board performance and accessibility needs. The current bounded model allows 2,000 objects; it does not claim unbounded rendering performance.

The authoritative board lives in `think.json` under the installation data directory, written through an fsynced temporary file and atomic rename. A monotonic revision provides compare-and-swap conflict protection. A stale client cannot overwrite another client's changes. The UI retains the losing draft and offers export/reload. Each tab keeps its draft in IndexedDB before attempting a network save. Export includes the original image data, coordinates, text, IDs and relationships; import is validated. Undo/redo currently lasts for the open canvas, while the content and camera survive reload.

The second stage builds viewport evidence: exact world bounds, zoom, dimensions, visible and selected objects, full semantic text even at low zoom, relationships and recent interaction events. Image objects explicitly state that visual content is unavailable. There is no claim of screenshot capture. The context is inspectable before sending through the standard Composer to an explicitly chosen existing session, using the existing durable outbox. Reading or editing never sends requests. Sending a request means accepted for delivery, not executed or completed; the destination transcript remains the source of truth.

AI layout uses the existing provider abstraction and returns coordinate proposals only. IDs and numeric bounds are validated, text/media are never accepted back from the model, and an exact board snapshot guards apply. The preview is visible before apply, can be cancelled, and applying creates one undo step. Pointer contact blocks applying a layout. The ordinary layout preview is a deterministic grid and is not labelled as AI. AI is requested separately from the context panel. No new paid service is introduced.

## Verification and remaining acceptance

Unit coverage checks camera transforms, low-zoom semantic evidence, invalid data, durable reload, corruption refusal, stale-write rejection and invalid model proposals. Integration, real desktop/mobile gestures, native keyboard behavior and end-to-end provider delivery must be verified before declaring the full feature ready. Do not publish a screenshot from a simulated UI or claim a live model result from a mocked provider test.

Initial verification on 2026-11-13: production build succeeds; all five targeted suites (41 tests) and the two interaction tests pass. The isolated Docker preview serves the actual app on loopback port 4416; real HTTP writes/readback and stale-write rejection pass. The preview has its own installation state and no user's provider credentials. It cannot demonstrate live AI responses until a configured provider is available. The PC is offline in the installation snapshot, so no real browser/mobile screenshots have been verified or published yet.

The full check now passes: 129 suites, 1,364 tests (one opt-in live test skipped), including typecheck, translation checks and shell checks. The public HTTPS preview returns 200 for the app and 401 for unauthenticated canvas data. `/tmp` on this VPS hit its user quota during the first suite run; verification was rerun with `TMPDIR` and `WEEVILS_TEST_ROOT` under a task-specific cache directory. The preview uses port 4416, not the reserved federation port 4192.

Final interaction coverage also verifies the standard composer, frozen request retries, offline draft recovery, stale recovered drafts, pointer capture, pinch zoom and both normal header entry variants. Real-browser verification remains outstanding.
