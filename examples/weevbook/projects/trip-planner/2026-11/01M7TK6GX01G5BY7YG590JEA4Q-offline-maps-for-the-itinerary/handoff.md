---
thread: 01M7TK6GX01G5BY7YG590JEA4Q
upTo: 23
at: 2026-11-19T19:11:45Z
by: claude:a3f9c1@server
---
# Handoff: Offline maps for the itinerary

## Goal

The map of a trip in trip-planner must work without signal: cache the raster tiles of the itinerary in the browser.

## State

### Done

- `src/map/offline.ts`: lists the tiles of a trip, enforces the 40 MB cap, downloads with progress and cancel.
- `public/sw.js`: `/tiles/` is served from the cache first.
- The trip page has "Save for offline" and "Remove offline map".

### In progress

Nothing.

### Next

Nothing asked yet.

## Decisions

- Raster tiles in Cache Storage, served cache first by the service worker (the app already uses Leaflet with raster tiles).
- Bounding box of the itinerary plus a margin, zoom 10 to 15, at most 40 MB per trip.
- Four downloads at a time, with a progress bar and a cancel button.
- The tile provider must allow bulk downloads; otherwise use a tile server of one's own.

## Files

- `src/map/offline.ts`
- `src/map/offline.test.ts`
- `public/sw.js`
- `src/pages/TripPage.ts`

## Run and test

- `npm test -- offline` (5 tests, all green)
- By hand: open a trip, save it, switch the browser to offline, reload.

## Not carried

- Nothing was left running.

## Open questions

- Which tile provider the app uses in production, and whether its policy allows this.
