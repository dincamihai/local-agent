---
column: Backlog
---

# Smoke test: live logs resource

Verify `pi://logs/current` returns container logs.

## How it works

1. Module-level ring buffer (`LOG_BUFFER`, 200 lines max)
2. On `pi_start`: spawns `podman logs -f <containerName>`, each line pushed to buffer
3. Buffer exposed as MCP resource `pi://logs/current`
4. Client can read resource on demand or subscribe for updates
5. On `pi_stop`: tail process killed, buffer cleared

Ring buffer caps memory regardless of task length.

## Status

**NOT COVERED** — needs new tests.

## Test cases

1. **Resource exists** — read `pi://logs/current` → returns recent log lines
2. **Ring buffer** — >200 lines → oldest dropped, newest kept
3. **Live tail** — `pi_start` → log tail process running
4. **Cleanup** — `pi_stop` → tail process killed, buffer cleared

## File

`pi-bridge-mcp.test.ts`
