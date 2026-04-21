---
column: Done
order: 30
created: 2026-04-21
parent: local-agent-delegation-queue
---

# Delegation queue: Agent worker loop

Implement worker loop for agents to poll and process queue.

## Worker behavior

1. Start agent container
2. Poll queue every N seconds
3. Claim task if available
4. Process task (pi_prompt + pi_wait + pi_result)
5. Update queue with result
6. Repeat or exit

## Configuration

- `QUEUE_POLL_INTERVAL` - seconds between polls (default: 5)
- `AGENT_IDLE_TIMEOUT` - exit after N seconds idle (default: 300)
- `MAX_TASKS_PER_AGENT` - max tasks before exit (default: unlimited)

## Failure handling

- Task timeout → release back to queue
- Agent crash → task requeued after timeout
- Retry limit before marking failed
