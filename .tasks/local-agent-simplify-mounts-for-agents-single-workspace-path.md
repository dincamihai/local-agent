---
column: Backlog
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

### Before
```ts
async start(workDir?: string, taskFile?: string, editDir?: string, name?: string)
```

### After
```ts
async start(contextDir?: string, taskFile?: string, editDir?: string, name?: string)
```

## Cases

| Scenario | Mounts |
|----------|--------|
| Git repo (worktree) | `/workspace:rw` only — worktree contents |
| Non-git repo (editdir) | `/workspace:rw` only — editdir contents |
| Read-only (no editdir, non-git) | `/context:ro` only — original workspace |

## Code change

`pi-bridge-mcp.ts` mount construction (~line 257):
```ts
const mounts: string[] = [];

if (worktreePath) {
  // Worktree active — single writeable mount, NO /context
  mounts.push("-v", `${worktreePath}:/workspace:rw`);
} else if (editDir) {
  // Explicit editdir (deprecated)
  mounts.push("-v", `${editDir}:/workspace:rw`);
} else if (contextDir) {
  // Read-only fallback — contextDir is the original workspace
  mounts.push("-v", `${contextDir}:/context:ro`);
}

// Always mount output directory
mounts.push("-v", `${OUTPUT_DIR}:/output`);
```

## Files

- `pi-bridge-mcp.ts` — mount logic in `PiAgent.start()`, variable rename
- `pi-bridge-mcp.test.ts` — test mount construction for each case, update mock calls

## Notes
- Backward compat: `workspace` param name unchanged in MCP schema
- `editdir` param still works (deprecated), maps to `/workspace`
- Read-only mode unchanged (no `editdir`, no worktree, non-git workspace)
- Skill documentation should reference `/workspace` only for editing
- `pi_merge` still meaningful for git worktree mode
