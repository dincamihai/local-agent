---
column: Backlog
parent: local-agent-remote-execution
part: 2/4
depends_on: local-agent-remote-dockerfile
---

# Remote agent: pi_start remote mode params
## Goal

Add `repo_url` and `repo_branch` params to `pi_start`. When present, run container in remote mode: pass env vars instead of bind-mounts, save `mode: "remote"` in state.

## Changes in pi-bridge-mcp.ts

### pi_start tool schema
Add optional params:
```ts
repo_url: z.string().optional().describe("Git repo URL — enables remote mode: container clones repo instead of using bind-mount"),
repo_branch: z.string().optional().describe("Branch name for remote mode (default: pi/<slug>)"),
```

### pi_start handler logic
```ts
const isRemote = !!repo_url;

if (isRemote) {
  const branch = repo_branch ?? `pi/${name}`;
  // Pass repo info as env vars; no workspace/task bind-mounts
  await pi.start(null, task, null, name, {
    env: {
      REPO_URL: repo_url,
      REPO_BRANCH: branch,
      GIT_TOKEN: process.env.GIT_TOKEN ?? "",
    }
  });
} else {
  // existing local mode
  await pi.start(workspace, task, editdir, name);
}
```

### State schema — add mode field
```ts
saveState({
  containerName: pi.containerName!,
  mode: isRemote ? "remote" : "local",
  repoBranch: isRemote ? (repo_branch ?? `pi/${name}`) : null,
  // existing fields...
});
```

### pi_start response
Remote mode response should include branch name instead of sentinel:
```
Pi agent starting as container '<name>' in remote mode.
Repo: <repo_url> → branch: pi/<name>
Agent will auto-push changes on completion.
Use pi_merge after pi_wait to fetch and merge the branch locally.
```

### PiRpcClient.start() signature
May need to accept optional `env` overrides to pass `REPO_URL` etc. Check existing signature in pi-bridge-mcp.ts and extend if needed.

## Notes
- `GIT_TOKEN` read from pi_bridge's own env — must be set in MCP server environment
- Local mode: no change if `repo_url` absent
- Sentinel file still written for remote mode (pi_bridge is local even in remote-container mode)

## Part of
`local-agent-remote-execution` — subtask 2/4

## Depends on
`local-agent-remote-dockerfile` (subtask 1)
