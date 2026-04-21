---
column: Done
updated: true
---

# Smoke test: delegation queue tools

Verify queue MCP tools work.

## How it works

SQLite-backed queue with atomic claim/release:

1. **queue_add** — inserts task with status `queued`, returns task ID
2. **queue_list** — queries all tasks, optionally filtered by status
3. **queue_status** — queries single task by ID
4. **queue_claim** — worker claims next `queued` task, sets status `processing` + `agentId`
5. **queue_complete** — marks task `done` with result
6. **queue_fail** — marks task `failed` with error
7. **queue_cancel** — only works on `queued` tasks, rejects `processing`

Worker loop polls queue, claims tasks, runs agent via `pi_prompt` + `pi_wait`, updates queue with result.

## Status

**NOT COVERED** — needs new tests.

## Test cases

1. **queue_add** — task added → returns task ID, status = queued
2. **queue_list** — lists all tasks with correct status
3. **queue_status** — returns correct task details
4. **queue_cancel** — queued task → removed, status = cancelled
5. **queue_cancel in-progress** — processing task → error, not cancelled

## File

`pi-bridge-mcp.test.ts`
