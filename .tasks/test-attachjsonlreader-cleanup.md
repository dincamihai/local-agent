---
column: Backlog
---

# Test: attachJsonlReader cleanup
# Test: attachJsonlReader cleanup

**Severity:** Low

## Bug

Lines 84-112: `attachJsonlReader` returns cleanup function, but no test verifies it removes event listeners.

## How to reproduce

Call cleanup multiple times or after stream ends — listeners may accumulate.

## Test to write

1. Attach reader to stream
2. Call cleanup function
3. Verify `data` and `end` listeners removed
4. Call cleanup twice — should not throw
5. Call cleanup after stream end — should handle gracefully

## File

`pi-bridge-mcp.test.ts`
