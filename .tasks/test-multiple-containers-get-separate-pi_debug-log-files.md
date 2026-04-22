---
column: Done
---

# Test: multiple containers get separate PI_DEBUG log files
# Test: multiple containers get separate PI_DEBUG log files

## Goal

Verify no filename collision when multiple agents log with PI_DEBUG=1.

## Test

1. Simulate `captureContainerLogs("pi-task-a", "task-a")`
2. Simulate `captureContainerLogs("pi-task-b", "task-b")`
3. Verify two distinct log files in PI_DEBUG_DIR
4. Verify filenames contain containerName + label + timestamp
5. Verify content captured separately (no overwrite)

## Part of
`pi_debug-log-survival-after-container-stopcleanup`

## Result

TEST 47 in `pi-bridge-mcp.test.ts`. Subprocess test with two `captureContainerLogs` calls and timestamp delay. Asserts 2 distinct files, correct name prefixes, separate content per container. PASS.
