---
column: Done
order: 40
created: 2026-04-21
parent: local-agent-delegation-queue
updated: true
---

# Delegation queue: board-tui integration

Show delegation status in board-tui task cards.

## Subtasks

- `delegation-queue-ui-badges` — UI badges for task cards (frontmatter + list/detail rendering)
- `delegation-queue-keybinding-d` — `d` keybinding to delegate selected task
- `delegation-queue-keybinding-D` — `D` keybinding to remove task from queue

## MCP tools for board-tui

- `queue_task(slug)` — add task to delegation queue
- `delegation_status(slug)` — get queue status for task

## Result
