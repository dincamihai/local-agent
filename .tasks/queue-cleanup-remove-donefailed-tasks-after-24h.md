---
column: Backlog
---

# queue cleanup: remove done/failed tasks after 24h
# queue cleanup: remove done/failed tasks after 24h

## Problem

Done and failed tasks accumulate in the SQLite queue forever. Queue grows unbounded.

## Fix

`workerTick` now runs cleanup before scanning:
```typescript
const cutoff = Date.now() - 24 * 60 * 60 * 1000;
db.prepare(`DELETE FROM tasks WHERE status IN ('done', 'failed') AND completed_at < ?`).run(cutoff);
```

## Behavior

- Tasks stay in queue with `done`/`failed` status for visibility
- After 24 hours, automatically purged on next `workerTick`
- `completed_at` timestamp used for age calculation

## Files

- `pi-bridge-mcp.ts` — `workerTick` cleanup logic
- `queue.ts` — `queueRemove` function (kept for future use)
- `scanner.test.ts` — `test_workerTick_cleans_up_old_tasks`

## Test

Test verifies:
- Old done task (>24h) deleted
- Old failed task (>24h) deleted
- Fresh done task (<24h) preserved
