---
column: Backlog
---

# Queue+Bridge integration test

End-to-end test for `processQueueTask()` and `workerTick()` — the most critical untested path.

## What to test

- `processQueueTask()`: start client for queued task, send prompt, auto-merge on success, `queueComplete` on success
- `processQueueTask()` merge failure: marks task as failed via `queueFail`, preserves worktree
- `processQueueTask()` error handling: agent crash, timeout
- `workerTick()`: picks queued task, claims slot, processes
- `workerTick()` slot full: re-queues task for later
- `workerTick()` no queued tasks: no-op
- Slot acquisition/rejection with concurrent `workerTick` calls

## Approach

Mock `PiRpcClient` methods. Use real SQLite queue. Verify state transitions in DB after each scenario.

## Queue

ID: d838b227-2a91-4dbd-a9ab-b015fb413891
