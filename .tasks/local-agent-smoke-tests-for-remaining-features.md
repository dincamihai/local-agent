---
column: Done
updated: true
---

# local-agent: smoke tests for remaining features
# local-agent: smoke tests for remaining features

Write smoke tests for features that lack test coverage.

## Features needing tests

### 1. Sentinel file notification (`local-agent-mcp-idle-notification`)
- On agent end, `/tmp/<containerName>.status` written with `{done, error, ts}`
- File exists after agent completes
- File contains valid JSON with `done: true`
- `pi_stop` cleans up sentinel file

### 2. Container logs resource (`local-agent-mcp-logs-resource`)
- `startLogTail` spawns `podman logs -f` process
- `getRecentLogs()` returns buffered lines
- `stopLogTail()` kills process and clears buffer
- Ring buffer caps at 200 lines

### 3. Agent-end notification (`local-agent-mcp-agent-end-notification`)
- `onAgentEnd` callback fires on `agent_end` event
- Callback passes error message when stop reason is error
- Callback passes undefined on success
- `auto_retry_end` with `success: false` triggers callback with error

### 4. Queue MCP tools (`delegation-queue-mcp-tools`)
- `queue_add` creates task with correct fields
- `queue_status` returns task by id
- `queue_list` returns all tasks, optionally filtered
- `queue_cancel` removes queued task, rejects non-queued

### 5. Machine-wide parallel limit (`local-agent-machine-wide-limit`)
- `acquireGlobalSlot` creates slot file in `/tmp/pi-bridge-slots/`
- Slot file named `<pid>-<instanceId>`
- `releaseGlobalSlot` deletes slot file
- Slots from dead PIDs evicted on next acquire
- Acquire returns false when count >= PARALLEL_LIMIT

### 6. Worker loop (`delegation-queue-worker`)
- `workerTick` claims task when slot available
- `workerTick` skips when at PARALLEL_LIMIT
- `processQueueTask` auto-merges worktree, marks task done
- `processQueueTask` preserves worktree on merge conflict

## File

Add to `pi-bridge-mcp.test.ts` (unit tests for classes/functions)
and `queue.test.ts` (queue operations already covered, add MCP tool tests).

## Approach

- Unit-test pure logic and file operations
- Mock `podman` and `child_process` where needed
- Use tmp directories for slot files and sentinel files
- Test worker loop with in-memory queue DB
