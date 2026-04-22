---
column: Done
updated: true
---

---
column: Done
order: 1000
---

# Smoke test: parallel agent limit

Verify `PARALLEL_LIMIT` enforced machine-wide.

## How it works

Slot directory enforces machine-wide concurrency across all `pi-bridge-mcp.ts` processes:

1. **acquireGlobalSlot** — scans `/tmp/pi-bridge-slots/`, evicts dead-PID files, counts live slots
2. If count < `PARALLEL_LIMIT` → creates slot file `/tmp/pi-bridge-slots/<pid>-<instanceId>`
3. If count >= limit → rejects `pi_start`
4. **releaseGlobalSlot** — deletes slot file on `pi_stop` or process exit

## Result

- Commit: `c62b479`
- Tests added to `pi-bridge-mcp.test.ts`:
  - TEST 14: `testSlotAcquisition`
  - TEST 15: `testSlotFullRejection`
  - TEST 16: `testDeadPidCleanup`
  - TEST 17: `testSlotRelease`
  - TEST 18: `testMcpToolRejectionAtLimit`
- All 34 pi-bridge tests passing
- Slot sanitization fix (`0b945d7`) also tested via `testPathTraversalInSlotFilename`
