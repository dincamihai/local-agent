---
column: Done
---

# Test: log file survives cleanupStaleInstances orphaned stop
# Test: log file survives cleanupStaleInstances orphaned stop

## Goal

Verify PI_DEBUG log file exists after `cleanupStaleInstances` stops orphaned container.

## Test

1. Mock deps for `cleanupStaleInstances`
2. State file with dead PID + containerName
3. Mock `podman logs` writes to temp dir during `podman stop` flow
4. Verify log file created BEFORE `podman stop`
5. Verify log file NOT deleted by cleanup

## Part of
`pi_debug-log-survival-after-container-stopcleanup`

## Result

TEST 46 in `pi-bridge-mcp.test.ts`. Required production fix: added `captureContainerLogs` to `CleanupDeps`, called before `podman stop` in `cleanupStaleInstances`. Test uses deps injection with mock that writes to temp dir. Asserts order and file survival. PASS.
