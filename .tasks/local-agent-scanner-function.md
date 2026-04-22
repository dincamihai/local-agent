---
column: Done
title: local-agent: implement scanReposForDelegation() function
updated: true
---

# local-agent: implement scanReposForDelegation() with MCP

Implement scanner that calls board-tui MCP to find and enqueue delegated tasks.

## Changes

- Add `scanReposForDelegation()` function:
  - Read `REPO_DIRS` env var (comma-separated repo paths)
  - For each repo: spawn board-tui MCP client
  - Call `list_delegated_tasks("queued")`
  - For each task:
    - Skip if already in queue (by taskSlug, not done/failed)
    - Call `queueAdd()` with prompt, workspace, taskFile, taskSlug
    - Call `set_frontmatter(slug, "delegation_status", "processing")`
  - Close MCP client
- Integrate into worker loop every `QUEUE_POLL_INTERVAL`

## TDD

Write tests BEFORE implementation:
- `test_scanner_calls_list_delegated_tasks` — MCP tool invoked
- `test_scanner_enqueues_found_task` — queue_add called
- `test_scanner_skips_already_enqueued` — no duplicates
- `test_scanner_updates_card_to_processing` — set_frontmatter called
- `test_scanner_builds_prompt_from_body` — prompt includes title + body

## Files

- `local-agent/pi-bridge-mcp.ts`
- `local-agent/scanner.test.ts`

## Result
