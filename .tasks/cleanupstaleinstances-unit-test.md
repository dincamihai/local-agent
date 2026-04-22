---
column: Done
updated: true
---

---
column: Done
order: 1000
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

## Result

- 11 tests added to `pi-bridge-mcp.test.ts` (TEST 33-43):
  - `testCleanupNoStaleInstances` — nothing cleaned when no stale state
  - `testCleanupOrphanedProcessKilled` — orphaned process (ppid <= 1) killed with SIGTERM
  - `testCleanupNonOrphanNotKilled` — process with alive parent NOT touched
  - `testCleanupStaleStateFileDeadPid` — dead PID: container stopped, file deleted
  - `testCleanupStateFileAlivePid` — alive PID: container + file left intact
  - `testCleanupPartialMixedPids` — partial: alive intact, dead removed
  - `testCleanupPgrepThrowsSwallowed` — pgrep error swallowed, no crash
  - `testCleanupPsThrowsSwallowed` — ps error swallowed, continues to next PID
  - `testCleanupPodmanStopThrowsSwallowed` — podman stop error swallowed, file still deleted
  - `testCleanupCorruptJsonSwallowed` — corrupt JSON swallowed, good file still cleaned
  - `testCleanupOwnPidExcluded` — own PID never appears in orphan list
- All 45 pi-bridge tests passing, all suites passing (scanner 12/12, queue 14/14, membrain 5/5)
