---
column: Done
order: 10
created: 2026-04-21
parent: local-agent-delegation-queue
updated: true
---

# Delegation queue: Core data structures

Implement queue storage and task status tracking.

## Requirements

- JSON file or SQLite for queue storage
- Task schema:
  ```ts
  {
    id: string
    taskSlug: string
    status: 'queued' | 'processing' | 'done' | 'failed'
    agentId?: string
    queuedAt: number
    startedAt?: number
    completedAt?: number
    result?: string
    error?: string
  }
  ```
- Atomic operations for claim/release
- Persist across restarts

## Functions

- `queueAdd(task)` - add to queue
- `queueClaim(agentId)` - claim next available task
- `queueComplete(taskId, result)` - mark done
- `queueFail(taskId, error)` - mark failed
- `queueStatus()` - list all tasks with status
