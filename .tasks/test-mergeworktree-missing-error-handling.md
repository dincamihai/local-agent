---
column: Backlog
---

# Test: mergeWorktree missing error handling
# Test: mergeWorktree missing error handling

**Severity:** Medium

## Bug

Line 302: `execSync` throws if worktree directory doesn't exist or was already removed. Catch block only logs but continues, causing subsequent operations to fail unpredictably.

## How to reproduce

```javascript
// Remove worktree externally, then call mergeWorktree
execSync('rm -rf /tmp/pi-worktrees/pi-test-123');
client.mergeWorktree(); // Throws unhandled
```

## Test to write

1. Create worktree normally
2. Delete worktree directory externally
3. Call `mergeWorktree()` — should handle gracefully, not throw
4. Call with non-existent worktree path — should return error, not crash

## File

`pi-bridge-mcp.test.ts`
