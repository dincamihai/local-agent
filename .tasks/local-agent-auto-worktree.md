---
column: Done
created: 2026-04-19
order: 1
---

# local-agent: auto git worktree for code edits

When `pi_start` receives a `workspace` that is a git repo and the task requires code edits, the agent currently writes directly to the main checkout via `editdir`. This risks dirtying the working tree and conflicts with active edits.

## Goal

Remove the `editdir` param. Instead, when `workspace` is provided, automatically:
1. Detect if `workspace` is a git repo (`git -C <workspace> rev-parse --git-dir`)
2. If yes, create a worktree on a new branch: `git -C <workspace> worktree add <worktree-path> -b pi/<slug>-<timestamp>`
3. Mount the worktree as `/workspace` (rw) instead of the original workspace
4. Store the worktree path on `PiAgent` instance
5. On `pi_stop`, run `git -C <workspace> worktree remove --force <worktree-path>` to clean up

If workspace is not a git repo, skip worktree creation (no write mount).

## File

`./pi-bridge-mcp.ts`

Relevant sections:
- `PiAgent.start()` — line 81: add worktree creation before spawn
- `PiAgent.stop()` — find stop method: add worktree cleanup
- `pi_start` tool handler — line 335: remove `editdir` param, add worktree logic
- `pi_start` tool schema — line 330: remove `editdir` from zod schema

## Constraints

- Branch name: `pi/<task-slug>-<unix-timestamp>` (slug from task filename, fallback to workspace basename)
- Worktree path: `/tmp/pi-worktrees/<branch-name>` 
- If `git worktree add` fails, fall back to no write mount (log warning to stderr)
- Backward compat: if workspace is not a git repo, behave as before (no editdir)
- Keep `editdir` param as hidden escape hatch with a deprecation note in the description

## Result

Committed as `cfd0a53`. Remaining follow-ups tracked as tasks 1-4.
