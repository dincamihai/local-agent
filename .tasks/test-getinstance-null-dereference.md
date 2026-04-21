---
column: Backlog
---

# Test: getInstance null dereference
# Test: getInstance null dereference

**Severity:** Medium

## Bug

Lines 544-548: When `instanceId` is undefined and `instances` is empty, returns `undefined`. Some callers don't check.

Line 961-966:
```javascript
const client = getInstance(instance_id);
if (!client?.isRunning) { ... }
const state = await client.getState();  // Throws if client is null
```

## How to reproduce

Call any tool with `instance_id` when no instances exist:
- `pi_state` with no instances
- `pi_wait` with no instances
- `pi_result` with no instances

## Test to write

Test all pi_* tools with:
1. No instances running
2. Invalid instance_id
3. Verify graceful error, not crash

## File

`pi-bridge-mcp.test.ts`
