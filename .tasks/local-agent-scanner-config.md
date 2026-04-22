---
column: Done
title: local-agent: add REPO_DIRS config and frontmatter parser
updated: true
---

# local-agent: add MCP client to talk to board-tui

Add MCP client capability to local-agent so it can query board-tui for delegated tasks.

## Changes

- Add `spawnBoardTuiClient(repoDir)` function in `pi-bridge-mcp.ts`
  - Spawns `board-tui-mcp` subprocess via stdio
  - Returns connected MCP client
- Add `list_delegated_tasks(repoDir, status)` wrapper
- Add `set_frontmatter(repoDir, slug, key, value)` wrapper

## TDD

Write tests BEFORE implementation:
- `test_spawnBoardTuiClient_starts_subprocess` — spawns board-tui-mcp
- `test_list_delegated_tasks_returns_tasks` — MCP call works
- `test_set_frontmatter_updates_card` — MCP call works
- `test_client_closes_cleanly` — no resource leak

## Files

- `local-agent/pi-bridge-mcp.ts`
- `local-agent/scanner.test.ts`

## Result
