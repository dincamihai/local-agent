---
column: Done
---

# Queue tests use in-memory SQLite

## Summary

Refactored `queue.test.ts` to use in-memory SQLite (`:memory:`) instead of temp file-based DB.

## Changes

- **queue.test.ts** — uses `openQueue(":memory:")` for isolation
- Added `withFileDb()` helper for persistence test (test 12)
- Removed temp file cleanup from most tests
- Test 14 fixed to work with in-memory DBs

## Result

- 14/14 tests passing
- Tests no longer write to production queue (`/tmp/pi-bridge-queue.db`)
- Faster execution (no disk I/O)
- Complete isolation between test runs
- No file cleanup needed — memory DB auto-destroyed on `db.close()`
- Persistence test (test 12) still uses file DB to verify WAL mode survives reopen
