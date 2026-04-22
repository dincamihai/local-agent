---
column: Done
updated: true
---

---
column: Done
order: 1000
---

# local-agent: tests for mount flows and param validation

## Goal

Write tests for all mount flow combinations. Find logic flaws by testing edge cases.

## Test matrix

| Test | `workspace` | `editdir` | `repo_url` | Expected mounts |
|------|-------------|-----------|------------|-----------------|
| Git worktree | git repo path | none | none | `/workspace:rw` only |
| Git + editdir | git repo path | explicit path | none | `/workspace:rw` only (editdir, no worktree) |
| Non-git editdir | non-git path | same path | none | `/workspace:rw` only |
| Non-git read-only | non-git path | none | none | `/context:ro` only |
| Remote mode | hidden | hidden | URL | `/output` only (container clones internally) |

## Result

- Commits: `115942d` (mount flow tests), `68f84f0` (remote delegation TDD tests)
- Tests added to `pi-bridge-mcp.test.ts`:
  - TEST 23: `testMountWorktreeOnly`
  - TEST 24: `testMountEditdirOverridesWorktree`
  - TEST 25: `testMountReadOnlyFallback`
  - TEST 26: `testMountTaskFile`
  - TEST 27: `testMountOutputAlwaysPresent`
  - TEST 28: `testNoDualMountBug`
- All 34 pi-bridge tests passing
- Dual-mount bug confirmed fixed
