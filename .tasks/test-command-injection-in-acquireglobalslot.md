---
column: Done
updated: true
---

---
column: Done
order: 1000
---

# Test: command injection in acquireGlobalSlot

**Severity:** High

## Bug

`instanceId` interpolated directly into shell command without sanitization.

## Fix

Sanitized instanceId via whitelist regex and `path.join()` validation in `acquireGlobalSlot()`.

## Result

- Commit: `0b945d7` (sanitize instanceId in acquireGlobalSlot)
- Test: `pi-bridge-mcp.test.ts` TEST 19: `testPathTraversalInSlotFilename`
  - Verifies `../`, shell metacharacters, newlines are blocked
  - Asserts `safeId` matches whitelist `^[a-zA-Z0-9_-]+$`
- All 34 pi-bridge tests passing
