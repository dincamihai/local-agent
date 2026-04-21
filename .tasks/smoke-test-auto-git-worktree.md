---
column: Backlog
---

# Smoke test: auto git worktree

Verify worktree auto-creation for git repos.

## How it works

When `pi_start` receives a `workspace` path that is a git repo:
1. Detects git repo via `git -C <workspace> rev-parse --git-dir`
2. Creates worktree: `git worktree add /tmp/pi-worktrees/pi/<slug>-<ts> -b pi/<slug>-<ts>`
3. Mounts worktree as `/workspace` (read-write) inside container
4. On `pi_stop`, removes worktree: `git worktree remove --force <path>`

If not a git repo or worktree creation fails → falls back to no write mount.
Explicit `editdir` param overrides worktree auto-create.

## Status

**COVERED** — `pi-bridge-mcp.test.ts` TEST 1-4:
- Happy path (git repo → worktree created)
- Not git repo (no worktree, no error)
- Explicit editdir (overrides auto-create)
- Failed creation (fallback to no write mount)

## File

`pi-bridge-mcp.test.ts` (already tested)
