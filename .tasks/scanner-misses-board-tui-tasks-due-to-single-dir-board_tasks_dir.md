---
column: Backlog
---

# scanner misses board-tui tasks due to single-dir BOARD_TASKS_DIR

## Bug

`workerTick` called `scanReposForDelegation()` without args. Default `BOARD_TASKS_DIR` = local-agent's own `.tasks`. Board-tui delegated tasks never found when session opened in board-tui.

## Fix

Changed default `BOARD_TASKS_DIR` from `LOCAL_AGENT_DIR/.tasks` to `process.cwd()/.tasks`. Each session scans the `.tasks` directory of the project it's opened in.

## Files

- `pi-bridge-mcp.ts` — default `BOARD_TASKS_DIR`

## Test

Open new session in board-tui. Delegate task with `d`. Scanner should pick it up from `board-tui/.tasks`.
