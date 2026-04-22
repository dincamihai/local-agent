---
column: Backlog
---

# local-agent: tests for mount flows and param validation

## Goal

Write tests for all mount flow combinations. Find logic flaws by testing edge cases.

## Status

Implemented in commit [pending]. 6 mount flow tests added, all passing.

## Test matrix

| Test | `workspace` | `editdir` | `repo_url` | Expected mounts |
|------|-------------|-----------|------------|-----------------|
| Git worktree | git repo path | none | none | `/workspace:rw` only |
| Git + editdir | git repo path | explicit path | none | `/workspace:rw` only (editdir, no worktree) |
| Non-git editdir | non-git path | same path | none | `/workspace:rw` only |
| Non-git read-only | non-git path | none | none | `/context:ro` only |
| Remote mode | hidden | hidden | URL | `/output` only (container clones internally) |

## Tests added

| # | Test | Status |
|---|------|--------|
| 23 | testMountWorktreeOnly | PASS |
| 24 | testMountEditdirOverridesWorktree | PASS |
| 25 | testMountReadOnlyFallback | PASS |
| 26 | testMountTaskFile | PASS |
| 27 | testMountOutputAlwaysPresent | PASS |
| 28 | testNoDualMountBug | PASS |

## Key findings

- Dual-mount bug confirmed fixed: worktree active → no `/context` mount
- Explicit editdir correctly suppresses worktree creation
- Non-git workspace falls back to `/context:ro` as expected
- Output mount present in all modes
- Task file mount appended when provided

## Files

- `pi-bridge-mcp.test.ts` — mount flow tests added

## Notes
- All 30 tests passing (24 existing + 6 new)
- Mount logic extracted into test clients to avoid actual container spawn
