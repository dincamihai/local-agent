---
column: Backlog
---

# Test: stopLogTail resource leak on exit
# Test: stopLogTail resource leak on exit

**Severity:** Medium

## Bug

Lines 249-262: When pi process exits, `stopLogTail()` never called. `logTailProc` keeps running as orphan.

```javascript
this.proc.on("exit", (code) => {
  this.proc = null;
  this.containerName = null;
  // stopLogTail() NOT called here!
});
```

## How to reproduce

1. Start agent via `pi_start`
2. Kill container externally: `podman kill pi-test`
3. Check for orphaned `podman logs -f` processes

## Test to write

1. Start agent, verify log tail process exists
2. Trigger agent exit (normal and error paths)
3. Verify `podman logs -f` process is killed
4. Test abort path as well

## File

`pi-bridge-mcp.test.ts`
