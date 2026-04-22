---
column: Done
---

# Test: log capture order in pi_stop
# Test: log capture order in pi_stop

## Goal

Verify `captureContainerLogs` runs BEFORE `podman stop` in `pi_stop` flow when PI_DEBUG=1.

## Why

If `podman stop` runs first, container exits and `podman logs` may capture nothing or partial output.

## Test

Mock `execSync` to record order of `podman logs` and `podman stop` calls during `pi_stop`. Assert `podman logs` command appears before `podman stop`.

## Part of
`pi_debug-log-survival-after-container-stopcleanup`

## Result

TEST 44 in `pi-bridge-mcp.test.ts`. Subprocess test with mock `execSync` recording command order. Asserts `podman-logs` at index 0, `podman-stop` at index 1. PASS.
