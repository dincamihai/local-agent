---
column: Done
title: board-tui: implement D keybinding to cancel delegation
updated: true
delegation_status: processing
---

---
column: Done
title: board-tui: implement D keybinding to cancel delegation
---

# board-tui: implement `D` keybinding to cancel delegation

Press `D` in board-tui to cancel a delegated task.

## Behavior

- Works only in task list view
- Selected task must have `delegation_status: queued|processing`
- Sets frontmatter `delegation_status: cancelled`
- Refreshes list view
- Notification: "cancelled `<slug>`"
- local-agent scanner will see `cancelled` and call `queue_cancel`

## TDD

Write tests BEFORE implementation:
- `test_D_sets_cancelled_on_queued_task` — frontmatter updated
- `test_D_sets_cancelled_on_processing_task` — still works
- `test_D_ignored_on_non_delegated` — no-op for regular tasks
- `test_D_ignored_in_detail_pane` — only works in board focus

## Files

- `board-tui/src/board_tui/app.py`
- `board-tui/tests/test_e2e_delegation_keybinding_D.py` (new)

## Result

- Added `Binding("D", "cancel_delegation", "cancel delegation")` to BINDINGS
- `action_cancel_delegation()` checks board focus, validates `delegation_status` is `queued|processing`, sets `delegation_status: cancelled`, dumps file, reloads
- Added `tests/test_e2e_delegation_keybinding_D.py` with 5 TDD tests
- Full suite: 206 passed
