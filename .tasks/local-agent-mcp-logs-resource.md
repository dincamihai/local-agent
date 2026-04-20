---
column: Done
created: 2026-04-19
order: 4
---

# local-agent: expose container logs as MCP resource

No way to observe agent progress without running `podman logs -f` manually. MCP Resources with subscriptions let the server push live log lines to the client automatically.

## Goal

Expose container logs as a subscribable MCP resource so Claude Code receives live updates without polling or bash loops.

## Implementation

In `pi-bridge-mcp.ts`:

1. Register a resource:
   ```ts
   server.resource("pi-logs", "pi://logs/current", async () => ({
     contents: [{ uri: "pi://logs/current", text: getRecentLogs() }]
   }));
   ```

2. On `pi_start`, begin tailing `podman logs -f <containerName>` in a child process. For each new line:
   - Append to an in-memory ring buffer (last ~200 lines)
   - Call `server.server.sendResourceUpdated({ uri: "pi://logs/current" })`

3. On `pi_stop`, kill the log-tail process and clear the buffer.

`getRecentLogs()` returns the ring buffer joined as a string.

## Notes

- Ring buffer caps memory use regardless of task length
- Same mechanism can carry agent backchannel messages (write to logs with a `[pi/message]` prefix) — may supersede the file-watch approach in `local-agent-agent-backchannel`
- URI `pi://logs/current` reflects the single-instance constraint; update if multi-agent support is added

## File

`./pi-bridge-mcp.ts`

## Result

Implemented the following changes to `/workspace/pi-bridge-mcp.ts`:

1. **Log buffer infrastructure** (lines 27-69): Added a module-level 200-line ring buffer (`LOG_BUFFER`), the `logPush()` method that drops oldest lines when full, `getRecentLogs()` that joins the buffer, `startLogTail(containerName)` that spawns `podman logs -f <name>` and feeds each line into the ring buffer, and `stopLogTail()` that kills the child process and empties the buffer.

2. **Resource registration** (line 400): Registered the `pi-logs` resource at URI `pi://logs/current` so the MCP client can read live container log output on demand.

3. **`pi_start` hook** (line 420): After `pi.start()`, `startLogTail()` is called to begin tailing the new container's logs. The client is immediately notified via `server.server.sendResourceUpdated()` so subscribed clients receive the initial buffer. The tool response text now references the live log resource.

4. **`pi_stop` hook** (line 435): `stopLogTail()` is called before cleanup to kill the log-tail process and clear the buffer, preventing stale data or orphaned processes.

All changes use existing dependencies (`podman`, `spawn`) and no new imports were needed beyond what was already present.
