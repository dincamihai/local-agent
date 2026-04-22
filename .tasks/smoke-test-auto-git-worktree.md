---
column: Done
updated: true
---

---
column: Done
order: 1000
---

# Smoke test: auto git worktree

Verify worktree auto-creation for git repos.

## How it works

When `pi_start` receives a `workspace` path that is a git repo:
1. Detects git repo via `git -C <workspace> rev-parse --git-dir`
2. Creates worktree: `git worktree add /tmp/pi-worktrees/pi/<slug>-<ts> -b pi/<slug>-<ts>`
3. Mounts worktree as `/workspace` (read-write) inside container
4. On `pi_stop`, removes worktree: `git worktree remove --force <path>`

## Result

- Covered by `pi-bridge-mcp.test.ts` TEST 1-4:
  - TEST 1: `testHappyPathWorktree` — git repo → worktree created with repo name in path
  - TEST 2: `testNoGitWorkspace` — no git repo → no worktree, falls back to basename
  - TEST 3a: `testExplicitEditdirOverrides` — explicit editdir suppresses worktree auto-create
  - TEST 4: `testFailedWorktreeCreation` — failed creation → falls back to no write mount
- All 34 pi-bridge tests passing
