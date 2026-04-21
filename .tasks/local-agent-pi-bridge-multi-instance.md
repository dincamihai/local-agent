---
column: Done
order: 99
updated: true
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

## Research findings (2026-04-21)

### host.docker.internal DNS issue
- Netavark backend doesn't always resolve `host.docker.internal`
- `host.containers.internal` works reliably
- Fix: use `--add-host=host.containers.internal:host-gateway` in pi-bridge-mcp.ts

### Ollama num_parallel setting
- `num_parallel` controls concurrent request batching
- Default: 1 (sequential processing)
- Setting `num_parallel=2` or higher:
  - Batches multiple requests into single GPU pass
  - Higher throughput (total tokens/sec)
  - Higher latency per request (waits for batch fill)
  - More VRAM usage
- For pi agents: probably not worth it unless running 3+ agents
- Agents spend most time waiting for tool execution, not model inference
- Configure in pi-models.json:
  ```json
  {
    "providers": {
      "ollama": {
        "models": [{
          "id": "qwen3.6:35b-a3b-q8_0",
          "numParallel": 2
        }]
      }
    }
  }
  ```

### Agent interleaving pattern
- Model idle during tool execution (bash, file I/O)
- Window: 100ms-10s per tool call
- Two agents can interleave:
  - Agent A: bash command → wait → model free
  - Agent B: thinks, queues tool call
  - Agent A: gets result, thinks
  - Agent B: gets model turn
- Real bottleneck: ollama processes one request at a time (unless num_parallel > 1)

### Workaround options tested
1. `--network=host` - works, but container shares all host ports
2. `host.containers.internal` - preferred, DNS resolves correctly
3. Add to `/etc/hosts` - requires sudo

## Tasks

- [ ] Refactor server state from single container ref to `dict[id → container]`
- [ ] Add `instance_id` param to all tools (default `"default"`)
- [ ] Implement global semaphore gated on `PARALLEL_LIMIT` env var
- [ ] Add `pi_list` tool
- [ ] Update `pi_start` response to include `instance_id`
- [ ] Write tests for multi-instance and limit enforcement
- [ ] Update README
