---
column: Superseded
created: 2026-04-19
order: 3
---

# local-agent: agent backchannel for mid-task messages

Agent has no way to communicate proactively during a task — stuck, needs clarification, found something unexpected. Add a file-based backchannel that MCP watches and surfaces as push notifications.

## Protocol

Agent writes JSON lines to `/output/messages.jsonl`:
```json
{"type": "stuck", "text": "cannot find the function, need clarification"}
{"type": "info", "text": "found 3 files affected, proceeding"}
{"type": "question", "text": "should I delete the old tests or keep them?"}
```

MCP server watches the file and emits `pi/message` notification per new line.

## Implementation

In `pi-bridge-mcp.ts`:

1. On `pi_start`, truncate/create `/output/messages.jsonl` (clean slate per session)
2. Use `fs.watch` on that file; on change, read new lines since last offset, emit per line:
   ```ts
   server.notification({
     method: "pi/message",
     params: { type, text, containerName: this.containerName }
   });
   ```
3. On `pi_stop`, close the watcher

In agent prompt (skill or task template): instruct agent to write to `/output/messages.jsonl` when stuck or needing input.

## File

`./pi-bridge-mcp.ts`

## Result
