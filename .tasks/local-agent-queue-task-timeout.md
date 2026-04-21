---
column: Done
---

# pi-bridge: configurable queue task timeout
Add `QUEUE_TASK_TIMEOUT` env var to control how long the worker waits for an agent to finish before declaring failure.

## Problem

`DEFAULT_TIMEOUT = 300_000` (5min) was used for queue tasks. Coding tasks typically take 10-30min — everything was timing out.

## Change

`pi-bridge-mcp.ts`: add constant after config block:
```ts
const QUEUE_TASK_TIMEOUT = parseInt(process.env.QUEUE_TASK_TIMEOUT ?? "1800000", 10); // 30min default
```

In `processQueueTask`, replace:
```ts
await client.waitForIdle();
```
with:
```ts
await client.waitForIdle(QUEUE_TASK_TIMEOUT);
```

Add `"QUEUE_TASK_TIMEOUT": "1800000"` to pi_bridge env in `~/.claude/settings.json`.

## Result
