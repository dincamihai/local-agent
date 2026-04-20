---
column: Backlog
order: 99
---

# pi_bridge: multi-instance support with global parallel limit

Allow running multiple pi agents in parallel, with a server-side concurrency limit shared across all MCP clients.

## Design

- `pi_start` returns an `instance_id` (slug derived from task name or user-supplied)
- All tools accept `instance_id` param (default: `"default"` for backwards compat)
- Server maintains `dict[instance_id → container]`
- Global semaphore enforced in server process — all Claude Code sessions share same limit automatically
- `PARALLEL_LIMIT` env var (default: `1`) configures max concurrent agents
- `pi_start` raises error if at limit (caller must wait or stop another instance)

## Tool changes

| Tool | New param | Notes |
|------|-----------|-------|
| `pi_start` | — | returns `instance_id` in response |
| `pi_prompt` | `instance_id` | |
| `pi_prompt_and_wait` | `instance_id` | |
| `pi_wait` | `instance_id` | |
| `pi_result` | `instance_id` | |
| `pi_state` | `instance_id` | |
| `pi_steer` | `instance_id` | |
| `pi_merge` | `instance_id` | |
| `pi_stop` | `instance_id` | |
| `pi_abort` | `instance_id` | |
| `pi_set_model` | `instance_id` | |
| `pi_list` | — | new tool — returns all active instances + status |

## Requirements

- Backwards compat: omitting `instance_id` uses `"default"` slot
- `pi_list()` returns `[{instance_id, container_name, model, state, started_at}]`
- `pi_start` response includes `instance_id` and `podman logs -f <name>` command
- Parallel limit enforced atomically (no race on concurrent `pi_start` calls)
- Document `PARALLEL_LIMIT` in README

## Tasks

- [ ] Refactor server state from single container ref to `dict[id → container]`
- [ ] Add `instance_id` param to all tools (default `"default"`)
- [ ] Implement global semaphore gated on `PARALLEL_LIMIT` env var
- [ ] Add `pi_list` tool
- [ ] Update `pi_start` response to include `instance_id`
- [ ] Write tests for multi-instance and limit enforcement
- [ ] Update README
