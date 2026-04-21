---
column: Backlog
order: 50
created: 2026-04-21
parent: local-agent-delegation-queue
---

# Delegation queue: Parallel agent pool

Run multiple agents concurrently from queue.

## Configuration

- `AGENT_POOL_SIZE` - max concurrent agents (default: 2)
- `num_parallel` in ollama for batched inference

## Architecture

```
Queue Manager (pi-bridge)
  ├─ Agent 1 (container)
  ├─ Agent 2 (container)
  └─ Agent N (container)
```

- Single queue, multiple workers
- Each agent claims task exclusively
- Ollama handles concurrent requests (with num_parallel)

## Scaling

- 2-3 agents optimal for 35B model
- Monitor VRAM usage
- Adjust based on task complexity
