---
column: Backlog
---

# cleanupStaleInstances unit test

Critical safety function with zero coverage. If broken, orphaned agents accumulate.

## What to test

- Finds and kills orphaned pi-bridge processes (checks PID liveness)
- Stops orphaned containers via podman
- Removes stale state files
- Dead PID detection via `process.kill(pid, 0)`
- All `try/catch` blocks that silently swallow errors
- No cleanup when all instances are alive
- Partial cleanup: some alive, some dead

## Approach

Mock `process.kill`, `child_process.execSync`, and filesystem ops. Create fake state files with dead PIDs.

## Queue

ID: 20e8ae5f-a017-4929-bf49-56ec4b9d4fda
