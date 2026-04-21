---
column: Backlog
---

# Audit board MCP concurrency safety
# Audit board MCP concurrency safety

## Problem

Multiple agents update board via MCP servers (`mcp__board-local-agent`, `mcp__board-membrain`, etc.) concurrently. File-based task storage may have race conditions.

## What to check

1. **File locking** — do MCP servers lock `.md` files before write?
2. **Read-modify-write** — any gaps between read and write where concurrent updates can be lost?
3. **Atomic writes** — are writes atomic (temp file + rename) or direct overwrite?
4. **MCP server implementation** — where is the code? Check:
   - `~/.claude/settings.json` MCP server URLs
   - Local MCP server scripts in repo

## Compare to queue

Queue (`queue.ts`) uses SQLite WAL mode:
- `journal_mode = WAL` — write-ahead logging
- Concurrent reads OK
- Writes serialized by SQLite

Board uses `.md` files — need same guarantees.

## Fix options

1. **File locking** — `flock()` or `proper-lockfile` around read-write
2. **Atomic writes** — temp file + `renameSync()`
3. **Optimistic locking** — version field in frontmatter, check-before-write
4. **Migrate to SQLite** — same pattern as queue

## Test to write

1. Spawn 2+ agents simultaneously updating same task
2. Verify no lost updates
3. Verify no corrupted YAML frontmatter

## Files

- Board MCP server implementation (unknown location — investigate)
- `.tasks/*.md` — task files
