---
column: Backlog
title: local-agent: handle cancelled delegation_status
---

# local-agent: handle `cancelled` delegation_status via MCP

Scanner should detect `delegation_status: cancelled` via board-tui MCP and remove matching queued tasks.

## Changes

- In `scanReposForDelegation()`:
  - Also call `list_delegated_tasks("cancelled")`
  - For each cancelled task:
    - Find matching queued task by taskSlug
    - Call `queue_cancel()` to remove from queue
    - Call `set_frontmatter(slug, "delegation_status", "")` — clear field
  - If `delegation_status: processing` and task not in queue:
    - Task picked up by worker, leave alone

## TDD

Write tests BEFORE implementation:
- `test_scanner_cancels_queued_task` — queue_cancel called
- `test_scanner_clears_frontmatter_after_cancel` — set_frontmatter called
- `test_scanner_ignores_processing_cancel` — does not abort running agent
- `test_scanner_skips_already_done` — no-op for done tasks

## Files

- `local-agent/pi-bridge-mcp.ts`
- `local-agent/scanner.test.ts`

## Result
