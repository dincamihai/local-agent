---
column: Backlog
---

# Smoke test: queue task timeout

Verify `QUEUE_TASK_TIMEOUT` respected.

## How it works

1. `QUEUE_TASK_TIMEOUT` env var (default 1800000ms = 30min)
2. Worker calls `client.waitForIdle(QUEUE_TASK_TIMEOUT)` instead of blocking forever
3. If agent exceeds timeout → task marked `failed` with timeout error
4. Timeout applies per task, not per agent session

Prevents long-running coding tasks from hanging indefinitely.

## Status

**NOT COVERED** — needs new tests.

## Test cases

1. **Timeout fires** — task > `QUEUE_TASK_TIMEOUT` → marked failed with timeout error
2. **Custom timeout** — env var override → timeout at custom value
3. **Default timeout** — no env var → 30min default (1800000ms)

## File

`pi-bridge-mcp.test.ts`
