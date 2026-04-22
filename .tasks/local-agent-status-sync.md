---
column: Backlog
title: local-agent: sync delegation status back to task cards
---

# local-agent: sync delegation status back to task cards via MCP

When worker completes or fails a queued task, update the originating task card via board-tui MCP.

## Changes

- In `processQueueTask()` completion handler:
  - Spawn board-tui MCP client for task workspace
  - Call `set_frontmatter(slug, "delegation_status", "done")` or `"failed"`
  - On failure, append error to `## Result` section (via `update_task`)
  - On success, append agent result to `## Result`
  - Close MCP client
- Handle case where task card was moved/deleted

## TDD

Write tests BEFORE implementation:
- `test_sync_status_updates_card_on_done` — set_frontmatter called with done
- `test_sync_status_updates_card_on_fail` — set_frontmatter called with failed
- `test_sync_appends_result_to_body` — update_task called
- `test_sync_handles_missing_card` — no crash if card deleted

## Files

- `local-agent/pi-bridge-mcp.ts`
- `local-agent/scanner.test.ts`

## Result
