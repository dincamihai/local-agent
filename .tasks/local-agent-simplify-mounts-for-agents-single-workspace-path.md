---
column: Done
order: 1
updated: true
---

---
column: Done
order: 1
---

# local-agent: simplify mounts for agents — single /workspace path

## Status

Implementing. Fixes dual-mount bug where agents see both `/context:ro` and `/workspace:rw`.

## Problem

Current dual-mount design confuses pi agents:
- `workspace` param → `/context:ro` (original repo, read-only)
- Auto-worktree → `/workspace:rw` (writeable worktree copy)

Agents see two directories. Try to edit `/context`, fail read-only. Or read `/workspace`, confused why different from `/context`.

Internal variable `workDir` also misnamed — suggests writeable workspace, actually read-only context.

## Fix

### 1. Skip `/context` mount when worktree active

### Before (bug)
```
-v /home/mihai/repos/foo:/context:ro
-v /tmp/pi-worktrees/foo/pi-task-123:/workspace:rw
```

### After (fixed)
```
-v /tmp/pi-worktrees/foo/pi-task-123:/workspace:rw
```

### 2. Rename internal variable

`workDir` → `contextDir` in `PiAgent.start()` signature and mount logic. Makes read-only intent explicit. Param name `workspace` stays for backward compat.

## Cases

| Scenario | Mounts |
|----------|--------|
| Git repo (worktree) | `/workspace:rw` only — worktree contents |
| Non-git repo (editdir) | `/workspace:rw` only — editdir contents |
| Read-only (no editdir, non-git) | `/context:ro` only — original workspace |

## Result

- Commits: `be1fa4a` (single-mount fix), `115942d` (mount flow tests)
- `pi-bridge-mcp.ts` — mount logic skips `/context` when worktree active, variable renamed to `contextDir`
- `pi-bridge-mcp.test.ts` — 6 mount flow tests added (TEST 23-28), all passing
- 34 total tests passing in pi-bridge suite
