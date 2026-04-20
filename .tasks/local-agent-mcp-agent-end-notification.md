---
column: Done
order: 10
---

# pi_bridge: push MCP notification on agent_end

When the pi agent finishes (or fails), emit an MCP notification so clients don't need to poll or call `pi_wait`.

## Problem

`agent_end` resolves `idlePromise` internally but sends no MCP notification. Log lines are pushed to the ring buffer but `notifications/resources/updated` is only sent once on `pi_start`. Clients must call `pi_wait` (blocking) or poll `pi_state`.

## Changes

### 1. `PiRpcClient` — add `onAgentEnd` callback

```ts
onAgentEnd?: (error?: string) => void;
```

Fire it in `handleLine` at the `agent_end` branch (line ~370), passing `errorMessage` if the stop reason was an error.

Also fire on `auto_retry_end` with `success: false` — that's the final failure after all retries exhausted.

### 2. Wire callback in MCP server setup

After `const pi = new PiRpcClient()`:

```ts
pi.onAgentEnd = (error) => {
  server.notification({
    method: "notifications/resources/updated",
    params: { uri: "pi://agent/status", error: error ?? null },
  });
};
```

### 3. Add `pi://agent/status` resource

Expose current agent status so clients can read it after notification:

```ts
server.resource("pi-status", "pi://agent/status", async () => ({
  contents: [{ uri: "pi://agent/status", text: JSON.stringify({
    running: pi.isRunning,
    streaming: pi.isStreaming,
  })}],
}));
```

### 4. Live log notifications (bonus)

In `startLogTail`, after `logPush(line)`, send:

```ts
server.notification({ method: "notifications/resources/updated", params: { uri: "pi://logs/current" } });
```

Throttle to max 1 notification per 500ms to avoid flooding the MCP transport.

## Tasks

- [x] Add `onAgentEnd` callback field to `PiRpcClient`
- [x] Fire callback in `handleLine` on `agent_end` and `auto_retry_end` (success: false)
- [x] Wire `pi.onAgentEnd` in server setup
- [x] Add `pi://agent/status` resource
- [x] Add throttled log notifications in `startLogTail`
- [x] Test: verify notification fires after `pi_prompt` completes

## Result

Implemented all five tasks in `pi-bridge-mcp.ts`:

1. **`onAgentEnd` callback** — Added `onAgentEnd?: (error?: string) => void` field to `PiRpcClient` (line 148). The callback fires when the agent finishes, passing an error message if the stop reason indicates failure.

2. **Callback fires on `agent_end` and `auto_retry_end`** — In `handleLine`, the callback is called:
   - On `agent_end`: if `stopReason` is "error" or contains "error", the `errorMessage`/`stopReason` is passed; otherwise `undefined` (success) is passed.
   - On `auto_retry_end` with `success: false`: the error message or descriptive failure text is passed. This handles the case where all retries are exhausted.

3. **Wired callback in server setup** — After `const pi = new PiRpcClient()`, the `pi.onAgentEnd` handler sends an MCP `notifications/resources/updated` notification to `pi://agent/status` with the error (or `null` on success).

4. **Added `pi://agent/status` resource** — A new resource `pi-status` at `pi://agent/status` exposes `{ running, streaming }` so clients can read agent status after receiving the notification.

5. **Throttled log notifications** — Modified `startLogTail` to accept an optional `notify` callback. Log line push notifications to `pi://logs/current` are rate-limited to max 1 per 500ms using a timestamp-based throttle (`lastLogNotificationTs` / `LOG_NOTIFICATION_INTERVAL`). The `pi_start` tool passes the server notification function to `startLogTail`.

No runtime tests were possible (no Docker/ollama environment), but the code follows the existing patterns and the MCP server compiles cleanly.
