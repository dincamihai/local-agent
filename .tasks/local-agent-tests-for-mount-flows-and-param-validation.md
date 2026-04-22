---
column: Backlog
---

# local-agent: tests for mount flows and param validation
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

## Param validation tests

- `REMOTE_DELEGATION` not set: `repo_url` param should NOT appear in MCP schema
- `REMOTE_DELEGATION` set: `workspace` param should NOT appear, `repo_url` mandatory
- Both `workspace` and `repo_url` passed: error (mutually exclusive)
- Neither `workspace` nor `repo_url` passed: error (one required)

## Logic edge cases

- `workspace` is git repo but `editdir` also passed → editdir wins, no worktree
- Worktree creation fails → falls back to `/context:ro`
- `workspace` is empty string → treat as not provided
- `workspace` does not exist → error

## Files

- `pi-bridge-mcp.test.ts` — add mount flow tests

## Notes
- Mock `fs.existsSync`, `execSync`, and `spawn` for isolation
- Test mount array contents, not actual container runs
- Verify `worktreePath` field set correctly on PiRpcClient instance
