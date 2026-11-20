# Add CSV export to orders

Project: shop-app · Started 2026-11-18 13:30 UTC · Thread 01M7QDKAT85KGENVY3NP4N74YB

---

**You** · 2026-11-18 13:30 UTC

Add a CSV export to the orders page. Same columns as the attached sample.

Attachment: [orders-sample.csv](attachments/5169e871e838550a9f845ea5c8902b35fca51c44071b9a1b7e57eda4ae532edb.csv)

- Read · /home/alex/.local/share/weevils/uploads/orders-sample.csv
- Grep · OrdersTable
- Write · src/orders/export.ts
- Edit · src/orders/OrdersPage.tsx
- Bash · SHOP_API_TOKEN=[redacted] curl -s "https://api.example.com/orders?limit=5"

**Agent** · 2026-11-18 13:34 UTC

The export is in place. An Export button on the orders page downloads `orders.csv` with the four columns of your sample.

The API gives amounts in cents; the file shows them as decimals (8450 → 84.50). I checked the output against five live orders.

**You** · 2026-11-18 13:52 UTC

Dates should be in the shop's time zone, not UTC. And add a test.

- Read · src/orders/export.ts
- Edit · src/orders/export.ts
- exec_command · git diff --stat
- exec_command · sed -n 1,80p src/orders/export.ts
- apply_patch
- apply_patch
- exec_command · npm test -- export

**Agent** · 2026-11-18 13:57 UTC

Dates now use the shop's time zone (`shop.timezone` in the settings, UTC when it is not set).

`src/orders/export.test.ts` covers the header, an amount, and an order placed just before midnight that falls on the previous day in UTC. 3 tests pass.

**You** · 2026-11-18 14:20 UTC

Thanks. Name the file orders-YYYY-MM-DD.csv, with the day of the export.

- apply_patch
- exec_command · npm test -- export

**Agent** · 2026-11-18 14:21 UTC

The file is now named after the day of the export in the shop's time zone, for example `orders-2026-11-18.csv`.
