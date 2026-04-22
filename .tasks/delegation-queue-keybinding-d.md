---
column: Done
updated: true
delegation_status: processing
---

# Delegation queue: keybinding `d` to delegate task

Press `d` in board-tui to add selected task to delegation queue.

## Behavior

- Works only in task list view
- Selected task must be in `Backlog` or `In Progress` column
- On success: update card frontmatter `delegation_status: queued`, refresh list
- On error: show error notification in TUI footer

## Files

- `board-tui/src/board_tui/app.py` — add `d` key binding handler

## Result

- Added `Binding("d", "delegate_task", "delegate")` to BINDINGS
- `action_delegate_task()` checks board focus, validates column, sets `delegation_status: queued`, dumps file, reloads
- Note: TUI cannot directly call MCP tools. Frontmatter update signals intent; actual `queue_add` must be called via MCP by AI assistant or separate worker.
- Added `tests/test_e2e_delegation_keybinding_d.py` with 4 TDD tests
- Full suite: 195 passed
