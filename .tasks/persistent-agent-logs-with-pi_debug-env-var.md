---
column: Done
updated: true
---

# Persistent agent logs with PI_DEBUG env var
# Persistent agent logs with PI_DEBUG env var

Agent containers are cleaned up on stop/exit, so logs are lost. When agents fail silently (completed with no output), there's no way to debug what happened.

## Problem

- `pi_stop` kills the container — `podman logs` becomes unavailable
- `startLogTail` ring buffer is in-memory, dies with the process
- `processQueueTask` auto-merges and stops — no log persistence
- Failed agents leave no trace

## Solution

### 1. `PI_DEBUG` env var

When `PI_DEBUG=1`, persist agent container logs to disk before container cleanup.

- Default: off (no log files, no disk usage)
- `PI_DEBUG=1`: write logs to `PI_DEBUG_DIR` (default: `/tmp/pi-bridge-logs/`)

### 2. Log file location

Each agent gets a log file: `PI_DEBUG_DIR/<containerName>[-<label>]-<timestamp>.log`

Contains full `podman logs <containerName>` output (stdout + stderr).

Example: `/tmp/pi-bridge-logs/pi-delegate-task-1745301234567.log`

### 3. Where to capture logs

In `processQueueTask` and `pi_stop` handler — before calling `client.stop()` or after agent completes:

```ts
if (PI_DEBUG) {
  const logDir = process.env.PI_DEBUG_DIR || "/tmp/pi-bridge-logs";
  mkdirSync(logDir, { recursive: true });
  const suffix = label ? `-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
  const logPath = `${logDir}/${containerName}${suffix}-${Date.now()}.log`;
  execSync(`podman logs ${containerName} > ${logPath} 2>&1`);
}
```

Also capture on error/failure paths so we can debug crashed agents.

### 4. Cleanup

Old log files NOT auto-deleted. User cleans up manually or via cron. Could add `PI_DEBUG_MAX_AGE` later.

### 5. Config

| Env var | Default | Description |
|---------|---------|-------------|
| `PI_DEBUG` | `""` | Set to `"1"` to enable persistent logs |
| `PI_DEBUG_DIR` | `/tmp/pi-bridge-logs` | Directory for log files |

## Files to modify

- `pi-bridge-mcp.ts` — add PI_DEBUG constant, capture logs in `processQueueTask` before stop, capture in `pi_stop` handler
- `pi-bridge-mcp.test.ts` — test that PI_DEBUG=1 writes log file, PI_DEBUG="" does not

## Verification

1. Set `PI_DEBUG=1` in pi_bridge env config
2. Queue a task, let agent complete
3. Check `/tmp/pi-bridge-logs/` for log files containing agent output
4. With `PI_DEBUG=""`, no log files created
