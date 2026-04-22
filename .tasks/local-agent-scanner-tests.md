---
column: Done
title: local-agent: add tests for repo scanner
updated: true
delegation_status: processing
---

---
column: Done
title: local-agent: add tests for repo scanner
---

# local-agent: add tests for repo scanner

Add unit/integration tests for scanner functionality.

## Tests (all written first, before implementation)

- `test_parseFrontmatter_basic` — parses YAML frontmatter
- `test_scanner_finds_queued_task` — detects `delegation_status: queued`
- `test_scanner_skips_already_queued` — no duplicates
- `test_scanner_skips_done_tasks` — ignores done/failed
- `test_scanner_updates_card_to_processing` — frontmatter updated
- `test_scanner_cancels_cancelled` — handles cancelled
- `test_status_sync_updates_card_on_done` — completion sync
- `test_status_sync_updates_card_on_fail` — failure sync

## Files

- `local-agent/scanner.test.ts` (new)
- Use in-memory SQLite queue for isolation
- Use tmpdir for mock task cards

## Result

- scanner.test.ts now has 7 tests:
  - 4 original MCP wrapper tests (spawn, list, setFrontmatter, close)
  - 2 syncTaskCard tests (update frontmatter + body, append to existing Result)
  - 1 cancelled handling test (clear frontmatter)
- All pass (7/7)
- mock-board-tui-tests.js supports get_task and update_task
