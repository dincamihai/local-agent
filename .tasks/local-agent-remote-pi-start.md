---
column: Done
parent: local-agent-remote-execution
part: 2/4
depends_on: local-agent-remote-dockerfile
updated: true
---

---
column: Done
order: 1000
---

# Remote agent: pi_start remote mode params

## Goal

Add `repo_url` and `repo_branch` params to `pi_start`. When present, run container in remote mode: pass env vars instead of bind-mounts, save `mode: "remote"` in state.

## Result

- Commits: `f6f54c1` (remote delegation mode), `68f84f0` (TDD tests)
- `pi-bridge-mcp.ts` — `pi_start` handler supports `repo_url` + `repo_branch` params, saves `mode: "remote"` in state
- Tests added to `pi-bridge-mcp.test.ts`:
  - TEST 29: `testRemoteDelegationMountConstruction`
  - TEST 30: `testRemoteDelegationEntrypointLocalMode`
  - TEST 31: `testRemoteDelegationEntrypointRemoteMode`
  - TEST 32: `testRemoteDelegationCredentialPriority`
- All 34 pi-bridge tests passing
- Part of `local-agent-remote-execution` — subtask 2/4 done
