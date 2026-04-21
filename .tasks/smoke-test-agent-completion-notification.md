---
column: Backlog
---

# Smoke test: agent completion notification

Verify sentinel file written on agent end.

## How it works

When agent finishes (success or error):
1. `pi.onAgentEnd` callback fires
2. Writes JSON to `/tmp/<containerName>.status`: `{done: true, error?: string, ts: number}`
3. `pi_start` response includes sentinel path + Monitor command for client
4. On `pi_stop`, sentinel file is deleted

Client gets non-blocking notification without polling or `pi_wait`.

## Status

**NOT COVERED** — needs new tests.

## Test cases

1. **Normal exit** — agent finishes → `/tmp/<containerName>.status` written with `{done: true, ts}`
2. **Error exit** — agent crashes → sentinel written with `{done: true, error: <msg>, ts}`
3. **Cleanup** — `pi_stop` removes sentinel file

## File

`pi-bridge-mcp.test.ts`
