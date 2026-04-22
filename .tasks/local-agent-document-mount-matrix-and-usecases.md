---
column: Done
updated: true
---

# local-agent: mount matrix and usecases

## Goal

Single reference for how container mounts work across all local-agent modes.

## Status

Implemented in commit `be1fa4a`. `pi-bridge-mcp.ts` now enforces single mount.

## Mount matrix

| Mode | `workspace` param | `editdir` param | `repo_url` param | Container paths | Access |
|------|-------------------|-----------------|------------------|-----------------|--------|
| **Git worktree** | path to git repo | none | none | `/workspace` | rw (worktree) |
| **Non-git editdir** | path to dir | explicit path | none | `/workspace` | rw (editdir) |
| **Read-only** | path to dir | none | none | `/context` | ro |
| **Remote clone** | hidden | hidden | URL | `/workspace` | rw (cloned) |

Always mounted: `/output` (rw) for agent artifacts.

**Key rule:** Only ONE repo mount active at a time (`/workspace` OR `/context`, never both).

## Usecases

### 1. Git worktree (default, recommended)
```
pi_start workspace="/home/mihai/repos/myproject"
```
Mounts:
- `/tmp/pi-worktrees/myproject/pi-task-123:/workspace:rw`
- `/home/mihai/repos/local-agent/output:/output`

Agent edits at `/workspace`. Changes mergeable via `pi_merge`.

### 2. Non-git explicit editdir (deprecated)
```
pi_start workspace="/home/mihai/somedir" editdir="/home/mihai/somedir"
```
Mounts:
- `/home/mihai/somedir:/workspace:rw`
- `/home/mihai/repos/local-agent/output:/output`

Same as worktree but no git operations. No merge step.

### 3. Read-only analysis
```
pi_start workspace="/home/mihai/repos/myproject"
```
When `workspace` is not a git repo and no `editdir`.

Mounts:
- `/home/mihai/repos/myproject:/context:ro`
- `/home/mihai/repos/local-agent/output:/output`

Agent reads at `/context`, writes results to `/output`. No `pi_merge` needed.

### 4. Remote delegation
```
# REMOTE_DELEGATION=1 set in MCP config
pi_start repo_url="https://github.com/user/repo"
```
Mounts:
- `/home/mihai/repos/local-agent/output:/output`
- `--secret gh-token` or SSH agent forwarded

Container runs `git clone` internally to `/workspace`. Agent edits at `/workspace`. Auto-push on exit.

## Container mount construction

```ts
const mounts: string[] = [];

if (repoUrl) {
  // Remote mode: no host repo mount, container clones internally
} else if (worktreePath) {
  // Git worktree mode — single mount, NO /context
  mounts.push("-v", `${worktreePath}:/workspace:rw`);
} else if (editDir) {
  // Explicit editdir mode
  mounts.push("-v", `${editDir}:/workspace:rw`);
} else if (contextDir) {
  // Read-only mode
  mounts.push("-v", `${contextDir}:/context:ro`);
}

// Always mount output directory
mounts.push("-v", `${OUTPUT_DIR}:/output`);

// Remote mode: add credential mounts
if (remoteMode) {
  mounts.push("--secret", "gh-token");
  if (process.env.SSH_AUTH_SOCK) {
    mounts.push("-v", `${process.env.SSH_AUTH_SOCK}:/ssh-agent`);
  }
}
```

## Notes
- Only one repo mount active at a time (`/workspace` OR `/context`, never both)
- `/output` always present for artifacts
- `pi_merge` only meaningful for git worktree mode (has branch to merge)
- Remote mode auto-pushes on exit; no `pi_merge` needed
