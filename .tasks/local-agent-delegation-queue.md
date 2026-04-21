---
column: Done
order: 5
created: 2026-04-21
updated: true
---

# local-agent: Delegation queue with agent pool

Implement a delegation queue system where tasks are queued and processed by a pool of local agents.

## Concept

- Single queue holds pending delegation tasks
- Pool of N agents (configurable) pull from queue
- Agents process tasks sequentially
- Task status tracked: queued → processing → done

## Components

1. **Queue storage** - JSON file or SQLite for persistence
2. **Queue manager** - Add/remove/list tasks, assign to agents
3. **Agent workers** - Poll queue, claim tasks, process, update status
4. **Status tracking** - Per-task: queued_at, started_at, completed_at, agent_id, result

## Integration

- board-tui shows delegation status in task card
- New column or badge: "Queued", "Processing (agent-1)", "Done"
- MCP tools: `queue_add`, `queue_status`, `queue_list`

## Acceptance

- Tasks can be queued via CLI or MCP
- Multiple agents process from same queue
- board-tui displays queue status on cards
