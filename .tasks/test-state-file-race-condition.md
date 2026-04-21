---
column: Backlog
---

# Test: state file race condition
# Test: state file race condition

**Severity:** Medium

## Bug

Lines 567-584: `saveState()` uses temp file + rename (correct), but concurrent operations can overwrite each other:

```javascript
function saveState(): void {
  const state: SavedState = { ... };
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);  // Race condition
}
```

## How to reproduce

Two agents end simultaneously via `onAgentEnd` callbacks, both call `saveState()`. One state snapshot lost.

## Test to write

1. Start 2 agents
2. End both at same time (trigger both onAgentEnd)
3. Verify state file contains both entries, no data loss

## Fix approach

Use file locking or serialize saveState calls.

## File

`pi-bridge-mcp.test.ts`
