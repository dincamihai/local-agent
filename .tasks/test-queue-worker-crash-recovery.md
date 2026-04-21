---
column: Backlog
---

# Test: queue worker crash recovery
# Test: queue worker crash recovery

**Severity:** High

## Bug

Lines 1131-1150: When `processQueueTask` throws after `queueClaim` succeeds but before `queueComplete/queueFail`, task stuck in `processing` forever.

```javascript
async function workerTick(): Promise<void> {
  const task = queueClaim(db, `worker-${process.pid}`);
  if (!task) return;
  processQueueTask(task).catch(() => {});  // Silent catch!
}
```

## How to reproduce

1. Queue a task
2. Claim it (status = processing)
3. Kill process before completion
4. Task stuck forever in `processing`

## Test to write

1. Add task to queue
2. Claim task (status = processing)
3. Simulate crash (kill worker)
4. Start new worker — task should be requeued after timeout
5. Verify timeout-based recovery mechanism

## Fix approach

Add `claimedAt` timestamp, requeue tasks stuck in `processing` beyond timeout.

## File

`pi-bridge-mcp.test.ts`
