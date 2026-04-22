---
column: Done
updated: true
delegation_status: processing
---

# Delegation queue: UI badges for task cards

Add visual delegation status indicators to board-tui task cards.

## Changes

- New frontmatter field: `delegation_status: queued|processing|done`
- Display badge/prefix in task list:
  - `⏳ task` — queued
  - `▶ task (agent-1)` — processing  
  - `✓ task` — done
- Detail panel shows:
  - Queue position
  - Agent name
  - Started/completed timestamps
  - Result output

## Files

- `board-tui/src/board_tui/app.py` — render badges in list/detail views
- `board-tui/src/board_tui/tasks.py` — parse `delegation_status` frontmatter

## Result

- `app.py` `_reload()` already renders delegation prefixes (⏳/▶/✓) at lines 127-133
- Detail panel shows `delegation_status` via existing frontmatter loop
- Added `tests/test_e2e_delegation_badges.py` with 7 TDD tests covering all states + mine interaction
- Full suite: 191 passed
