---
thread: 01M7M8E6XR7ZVPYA7TRMHKHR25
upTo: 33
at: 2026-11-17T08:22:05Z
by: claude:a3f9c1@server
---
# Handoff: Fix the login redirect

## Goal

After signing in, people must land on the page they came from, with the rest of the query string kept.

## State

### Done

- `redirectAfterLogin` reads `returnTo` from the query string, keeps only paths inside the site, falls back to `/`.
- Every other query parameter is carried over to the destination (`coupon`, …).

### In progress

Nothing.

### Next

Nothing asked yet.

## Decisions

- Only same-site paths are accepted in `returnTo` (no absolute address), to avoid an open redirect.
- `returnTo` itself is dropped from the carried parameters.

## Files

- `src/auth/redirect.ts`
- `test/auth/redirect.test.ts`

## Run and test

- `npm test -- auth` (14 tests, all green)

## Not carried

- Nothing was left running.

## Open questions

None.
