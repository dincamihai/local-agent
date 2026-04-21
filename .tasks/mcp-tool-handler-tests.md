---
column: Backlog
---

# MCP tool handler tests

All 14 MCP tool handlers in `pi-bridge-mcp.ts` have zero integration tests.

## What to test

- `pi_start`: valid start, workspace mount, instance tracking, `getInstance()` lookup
- `pi_stop`: stop running instance, stop non-existent instance
- `pi_list`: returns all active instances
- `pi_prompt` / `pi_prompt_and_wait`: send prompt to running instance
- `pi_merge`: merge worktree, merge non-existent instance
- `pi_wait`: wait for idle, timeout
- `pi_result`: get result from completed instance
- `pi_state`: get state of running instance
- `pi_steer` / `pi_follow_up` / `pi_abort`: send to running instance
- `pi_set_model`: change model
- `pi_compact`: compact context
- Error paths: instance not found, wrong state, slot full

## Approach

Mock `PiRpcClient` class. Test each handler via MCP protocol call. Verify response format and side effects.

## Queue

ID: f3c5f7f8-a2c9-437c-982d-ceba15f9bb95
