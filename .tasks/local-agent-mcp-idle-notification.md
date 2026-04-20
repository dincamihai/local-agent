---
column: Done
created: 2026-04-19
order: 2
---

# local-agent: non-blocking agent completion notification

Goal: Claude Code gets notified when agent finishes without calling `pi_wait` (blocks) or running a manual Monitor each time.

## Current state

`agent-end-notification` task (Done) already wired `sendResourceUpdated` on `pi://agent/status` and registered the resource. But notifications likely don't reach Claude Code because:

1. `McpServer.resource()` only sets `capabilities.resources.listChanged: true` — no `subscribe: true`
2. Without `subscribe: true`, MCP clients won't send `resources/subscribe` requests
3. Without a subscription, `sendResourceUpdated` fires into void

## Investigation first

Test whether Claude Code actually subscribes to MCP resources:
- Add `subscribe: true` to pi-bridge server capabilities
- Add `resources/subscribe` + `resources/unsubscribe` handlers (low-level `server.server.setRequestHandler`)
- Run agent, check if Claude Code reads `pi://agent/status` on completion without explicit `pi_state` call

If Claude Code DOES support subscriptions → `sendResourceUpdated` path works, no further changes needed.

If it DOESN'T → fall back to sentinel file approach:
- On `agent_end`, write `/tmp/pi-<containerName>-done` (or update a known file)
- `pi_start` response includes the sentinel path + ready-made Monitor command
- Claude Code runs Monitor in background — gets notified when file appears

## Custom notification alternative

The lower-level approach (`server.notification({ method: "pi/idle", ... })`) may also work if Claude Code listens for custom MCP notifications. Worth testing alongside the subscription path.

## File

`./pi-bridge-mcp.ts`

## Result

Tested and confirmed: **Claude Code does not send `resources/subscribe`** — verified by adding stderr→file tee, listing resources, and reading resources explicitly. No subscribe events observed.

Implemented sentinel file fallback instead:

1. **MCP subscription support (kept)** — `subscribe: true` capability + `SubscribeRequestSchema`/`UnsubscribeRequestSchema` handlers remain in case future Claude Code versions support it. `sendResourceUpdated` guarded against unsubscribed URIs.

2. **Sentinel file on agent end** — `pi.onAgentEnd` writes `/tmp/<containerName>.status` with `{done, error, ts}` JSON when agent finishes.

3. **`pi_start` response updated** — Now includes sentinel path and a ready-to-use Monitor command: `until [ -f /tmp/<name>.status ]; do sleep 1; done && cat /tmp/<name>.status`

4. **`pi_stop` cleans up sentinel** — Removes sentinel file on container teardown.

5. **Removed debug tee** — Temporary stderr→`/tmp/pi-bridge-debug.log` tee removed after test.
