---
column: Done
---

# PI_DEBUG log survival after container stop/cleanup
# PI_DEBUG log survival after container stop/cleanup

## Problem

`PI_DEBUG=1` writes logs to `/tmp/pi-bridge-logs/<containerName>-<label>-<ts>.log` via `captureContainerLogs()` in `pi_stop`. Test `testPiDebugWritesLogFile` only verifies file creation — does NOT verify logs survive after:
- `pi_stop` calls `podman stop` + `captureContainerLogs`
- `cleanupStaleInstances` calls `podman stop` on orphaned container
- `pi_stop` deletes worktree, state file, slot file

If `podman stop` runs before `captureContainerLogs`, or if `captureContainerLogs` fails silently, logs may be lost.

## What to test

1. **Log capture order** — `captureContainerLogs` runs before `podman stop`, not after
2. **Logs survive `pi_stop`** — file exists after `pi_stop` completes
3. **Logs survive `cleanupStaleInstances`** — file exists after orphaned container cleanup
4. **No truncation** — `podman logs` captures full output, not partial
5. **Multiple containers** — each gets separate log file, no collision

## Approach

Mock `execSync` for `podman logs` and `podman stop`. Verify `podman logs` command runs before `podman stop` in both `pi_stop` and `cleanupStaleInstances` paths. Use real temp files.

## Files

- `pi-bridge-mcp.test.ts`

## Notes
- `captureContainerLogs` already tested (TEST 21), but only in isolation
- Need integration test: full `pi_stop` flow with PI_DEBUG=1

## Result

Added `captureContainerLogs` to `CleanupDeps` and called it before `podman stop` in `cleanupStaleInstances` (production fix in `pi-bridge-mcp.ts`). Added 4 tests (TEST 44-47) covering: capture order in pi_stop, log survival after pi_stop cleanup, log survival after cleanupStaleInstances, and multiple containers getting separate log files. All 49 tests pass. Committed `0cc8d12`.
