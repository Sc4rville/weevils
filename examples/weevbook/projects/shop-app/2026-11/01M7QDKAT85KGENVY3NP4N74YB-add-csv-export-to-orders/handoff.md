---
thread: 01M7QDKAT85KGENVY3NP4N74YB
upTo: 47
at: 2026-11-18T14:21:50Z
by: codex:c81d2e@laptop
---
# Handoff: Add CSV export to orders

## Goal

A CSV export on the orders page, with the columns of `orders-sample.csv`: order, date, customer, total.

## State

### Done

- `src/orders/export.ts`: `toCsv(orders)`, with quoting of commas and quotes.
- An Export button on the orders page downloads `orders.csv`.
- Dates are written in the shop's time zone (`shop.timezone`, UTC when unset).
- The file is named `orders-YYYY-MM-DD.csv`, with the day of the export.

### In progress

Nothing.

### Next

Nothing asked yet.

## Decisions

- Amounts are written as decimals (the API gives cents).
- The file is built in the browser from the orders already loaded; no new server route.

## Files

- `src/orders/export.ts`
- `src/orders/export.test.ts`
- `src/orders/OrdersPage.tsx`

## Run and test

- `npm run dev`, then the Export button on `/orders`
- `npm test -- export` (3 tests, all green)

## Not carried

- The dev server (`npm run dev`, port 5173) was running on laptop; start it again where the work continues.
- `SHOP_API_URL` and the API credential come from `.env.local`, which is not in the repository and does not travel.

## Open questions

None.
