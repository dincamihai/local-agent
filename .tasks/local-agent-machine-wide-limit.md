---
column: Done
order: 100
created: 2026-04-21
---

# pi-bridge: machine-wide parallel agent limit

Currently `PARALLEL_LIMIT` is enforced per MCP server process. Two Claude Code sessions each get their own limit, allowing more agents to run than intended.

## Goal

Enforce a single machine-wide concurrency cap across all `pi-bridge-mcp.ts` processes on the host.

## Approach options

1. **Lockfile + counter** — `/tmp/pi-bridge-global.lock` with atomic increment/decrement using `flock`. Simple, no daemon needed.
2. **Unix domain socket** — one process acts as coordinator, others connect to claim/release slots. More robust but requires a coordinator lifecycle.
3. **Shared file + polling** — scan `/tmp/pi-bridge-state-*.json` files to count live containers across all PIDs before starting. No locking, but racy under concurrent starts.

Recommended: option 1 (lockfile + counter). Atomic file ops with `flock` are straightforward in Node via `child_process.execSync`.

## Implementation sketch

```ts
function acquireGlobalSlot(limit: number): boolean {
  // flock-based atomic read-increment on /tmp/pi-bridge-global-count
  // return false if count >= limit
}

function releaseGlobalSlot(): void {
  // atomic decrement
}
```

- Call `acquireGlobalSlot(PARALLEL_LIMIT)` in `pi_start` before reserving local slot
- Call `releaseGlobalSlot()` in `client.onExit`
- `PARALLEL_LIMIT` env var becomes machine-wide cap (same var, different scope)

## Result

Slot directory approach: `/tmp/pi-bridge-slots/<pid>-<instanceId>` per running agent. `acquireGlobalSlot` scans dir, evicts dead-PID files, rejects if count >= `PARALLEL_LIMIT`. `releaseGlobalSlot` deletes file on stop or exit. Self-heals after crashes.
