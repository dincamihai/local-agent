---
column: Done
title: local-agent: implement repo scanner for delegated tasks
delegation_status: processing
updated: true
---

# local-agent: implement repo scanner for delegated tasks

Implement MCP client in local-agent that periodically queries board-tui for delegated tasks and enqueues them.

## Architecture: MCP Client-Server

```
board-tui (MCP server) ←── local-agent (MCP client)
  list_delegated_tasks()      queue_add()
  set_frontmatter()           spawn pi agent
```

**Flow:**
1. User presses `d` in board-tui → `delegation_status: queued`
2. local-agent worker spawns board-tui MCP client
3. Calls `list_delegated_tasks("queued")` → gets tasks
4. For each: `queue_add()` + `set_frontmatter(..., "processing")`
5. Worker picks up, spawns pi agent
6. On completion: `set_frontmatter(..., "done")`

## Subtasks

1. `board-tui-list-delegated-tasks-mcp` — board-tui: add list_delegated_tasks MCP tool (dependency — must be done first)
2. `local-agent-scanner-config` — add MCP client + wrappers
3. `local-agent-scanner-function` — scanReposForDelegation() via MCP
4. `local-agent-status-sync` — sync done/failed back to cards via MCP
5. `local-agent-handle-cancelled` — handle cancelled via MCP
6. `board-tui-cancel-delegation` — board-tui: D keybinding
7. `local-agent-scanner-tests` — unit/integration tests

## Dependencies

- `board-tui-list-delegated-tasks-mcp` must be implemented first
- board-tui-mcp must be installable as CLI (`pip install -e .` already provides `board-tui-mcp`)

## Result
