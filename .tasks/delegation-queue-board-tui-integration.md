---
column: Backlog
order: 40
created: 2026-04-21
parent: local-agent-delegation-queue
---

# Delegation queue: board-tui integration

Show delegation status in board-tui task cards.

## UI changes

- New frontmatter field: `delegation_status: queued|processing|done`
- Display badge/prefix in list:
  - `⏳ task` - queued
  - `▶ task (agent-1)` - processing
  - `✓ task` - done
- Detail panel shows:
  - Queue position
  - Agent name
  - Started/completed timestamps
  - Result output

## Key bindings

- `d` - delegate selected task (add to queue)
- `D` - show delegation status

## MCP tools for board-tui

- `queue_task(slug)` - add task to delegation queue
- `delegation_status(slug)` - get queue status for task
