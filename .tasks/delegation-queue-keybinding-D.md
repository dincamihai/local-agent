---
column: Superseded
updated: true
delegation_status: processing
---

# Delegation queue: keybinding `D` to remove task from queue
# Delegation queue: keybinding `D` to remove task from queue

Press `D` in board-tui to remove selected task from delegation queue.

## Behavior

- Works only in task list view
- Selected task must have `delegation_status: queued|processing`
- Calls `cancel_queued_task(id)` or `pi_abort(instance_id)` MCP tool on `local-agent` board
- On success: clear `delegation_status` frontmatter, refresh list
- On error: show error notification in TUI footer

## Files

- `board-tui/src/board_tui/app.py` — add `D` key binding handler

## Result
