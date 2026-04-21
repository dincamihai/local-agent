---
column: Backlog
---

# PiRpcClient unit tests

Cover critical untested paths in `pi-bridge-mcp.ts`.

## What to test

- `attachJsonlReader`: partial JSON lines, `\r\n` line endings, buffer flushing on stream end, cleanup function
- `handleLine()` state machine: every event type (`response`, `agent_start`, `message_update` with `text_delta`, `auto_retry_end`, `agent_end` with error detection)
- `start()` container spawn: correct `-v` flags, env vars, command args (mock `child_process`)
- `stop()`: not-running early return, SIGTERM + 5s SIGKILL timeout, log/JSONL reader cleanup
- `mergeWorktree()` happy path: clean worktree with uncommitted changes, clean worktree nothing to commit, `keepBranch=true`
- `waitForIdle()`: already idle returns immediately, timeout after `DEFAULT_TIMEOUT`
- `ensureReady()` / `waitForReady()`: retry loop, timeout, process exit during startup
- `send()`: process not running returns error, message serialization

## Approach

Mock `child_process.spawn` and filesystem ops. Test each method in isolation.

## Queue

ID: 70d7213f-868c-47ad-9f13-6afa970c44da
