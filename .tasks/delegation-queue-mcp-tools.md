---
column: Done
order: 20
created: 2026-04-21
parent: local-agent-delegation-queue
updated: true
---

# Delegation queue: MCP tools

Expose queue operations as MCP tools.

## New tools

| Tool | Description |
|------|-------------|
| `queue_add` | Add task to delegation queue |
| `queue_status` | Get status of specific task |
| `queue_list` | List all queued/processing tasks |
| `queue_cancel` | Remove task from queue |
| `queue_claim` | Agent claims next task (internal) |
| `queue_complete` | Agent marks task done (internal) |

## Integration

- `pi_prompt` optionally adds task to queue instead of direct prompt
- Queue-aware `pi_start` that auto-claims from queue
