---
column: Backlog
---

# Test: race condition in slot acquisition
# Test: race condition in slot acquisition

**Severity:** High

## Bug

`acquireGlobalSlot()` at lines 38-56 is not atomic. Two concurrent processes can both read `live < PARALLEL_LIMIT` and both proceed to write slot files, exceeding the limit.

## How to reproduce

```bash
PI_BRIDGE_PORT=3200 npx tsx pi-bridge-mcp.ts &
PI_BRIDGE_PORT=3201 npx tsx pi-bridge-mcp.ts &
# Both may pass the live >= PARALLEL_LIMIT check
```

## Test to write

Concurrent slot acquisition test:
1. Spawn N+1 processes simultaneously attempting to acquire slots
2. With `PARALLEL_LIMIT=2`, only 2 should succeed
3. Verify atomic read-modify-write using file locking

## Fix approach

Use `flock()` for atomic increment or use a single coordinator process.

## File

`pi-bridge-mcp.test.ts`
