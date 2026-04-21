---
column: Backlog
---

# Smoke test: agent status resource

Verify `pi://agent/status` reflects agent state.

## How it works

1. `PiRpcClient` has `onAgentEnd` callback fired on `agent_end` and `auto_retry_end`
2. Callback triggers MCP notification: `notifications/resources/updated` → `pi://agent/status`
3. Resource exposes `{running: boolean, streaming: boolean}`
4. Client reads resource after notification to get final state

## Status

**NOT COVERED** — needs new tests.

## Test cases

1. **Running** — agent active → `{running: true, streaming: false|true}`
2. **Idle** — agent done → `{running: false, streaming: false}`
3. **onAgentEnd fires** — notification sent on `agent_end` and `auto_retry_end`

## File

`pi-bridge-mcp.test.ts`
