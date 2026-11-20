# Fix the login redirect

Project: shop-app · Started 2026-11-17 08:02 UTC · Thread 01M7M8E6XR7ZVPYA7TRMHKHR25

---

**You** · 2026-11-17 08:02 UTC

After signing in, people land on /undefined instead of the page they came from. Can you find out why and fix it?

- Grep · returnTo
- Read · src/auth/redirect.ts
- Edit · src/auth/redirect.ts
- Bash · Run the auth tests

**Agent** · 2026-11-17 08:03 UTC

Found it. `redirectAfterLogin` read `returnTo` from the session, but the login form sends it as a query parameter, so the value was always undefined.

It now reads the query parameter, accepts only paths inside the site, and falls back to `/`. The 12 auth tests pass.

**You** · 2026-11-17 08:11 UTC

Good. Keep the rest of the query string too, some links carry a coupon code.

- Read · src/auth/redirect.ts
- Edit · src/auth/redirect.ts
- Bash · See what the folder holds
- Read · src/auth/redirect.ts
- Edit · src/auth/redirect.ts
- Edit · test/auth/redirect.test.ts
- Bash · Run the auth tests

**Agent** · 2026-11-17 08:21 UTC

Done. The redirect now carries every query parameter except `returnTo` itself, so `/login?returnTo=/cart&coupon=FALL10` ends on `/cart?coupon=FALL10`.

Two new tests cover it; the 14 auth tests pass.
