# Offline maps for the itinerary

Project: trip-planner · Started 2026-11-19 19:05 UTC · Thread 01M7TK6GX01G5BY7YG590JEA4Q

---

**You** · 2026-11-19 19:05 UTC

I'm building trip-planner, a small web app for our hiking trips. I want the map to work without signal. What are my options?

**ChatGPT** · 2026-11-19 19:05 UTC

Three realistic options:

1. Cache the raster tiles in the browser (Cache Storage, served by a service worker).
2. Ship vector tiles as one PMTiles file per region.
3. Pre-render one static image per day of the trip.

Which one fits depends on the map library you already use and on how large an area a trip covers.

**You** · 2026-11-19 19:05 UTC

The app already uses Leaflet with raster tiles. A trip covers a small area. What's the least work?

**ChatGPT** · 2026-11-19 19:05 UTC

Then cache the raster tiles. Take the bounding box of the itinerary plus a margin, zoom levels 10 to 15, and store the tiles in Cache Storage; the service worker answers from the cache first. Expect about 30 MB per trip.

Check the tile provider's usage policy first: many forbid bulk downloads. Use one that allows it, or your own tile server.

**You** · 2026-11-19 19:05 UTC

OK, let's do that. Cap it at 40 MB per trip and show progress while it downloads.

**ChatGPT** · 2026-11-19 19:05 UTC

Plan:

- A "Save for offline" button on the trip page.
- List the tiles for the bounding box, zoom 10 to 15; stop adding zoom levels when the estimate passes 40 MB.
- Download four at a time, with a progress bar and a cancel button.
- The service worker serves `/tiles/` from the cache first, then the network.
- A "Remove offline map" button that deletes the trip's cache.

**You** · 2026-11-19 19:06 UTC

Implement the tile cache we discussed, with the 40 MB cap and the progress bar.

- Grep · L\.tileLayer
- Read · src/map/TripMap.ts
- Write · src/map/offline.ts
- Edit · public/sw.js
- Edit · src/pages/TripPage.ts
- Bash · Run the new tests

**Agent** · 2026-11-19 19:11 UTC

It is in. The trip page has a "Save for offline" button: it lists the tiles around the itinerary for zoom 10 to 15, drops the deepest zoom levels until the estimate fits in 40 MB, and downloads four at a time with a progress bar and a cancel button. The service worker answers `/tiles/` from the cache first. "Remove offline map" deletes the trip's cache.

One thing to check on your side: the app points at `tiles.example.com`. Make sure that provider allows saving tiles.

**You** · 2026-11-19 20:02 UTC

Looks good. What happens if the cap is reached in the middle of a download?

**Agent** · 2026-11-19 20:02 UTC

It cannot be reached mid-way: the list of tiles is fixed before the first download, from an estimate of 25 KB per tile, and zoom levels are dropped until the total fits. If real tiles turn out heavier, the download still stops at 40 MB and the page says which zoom levels are missing.
