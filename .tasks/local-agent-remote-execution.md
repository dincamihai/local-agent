---
column: Backlog
---

# Remote agent: run pi_bridge on separate machine (AWS ECS)

## Goal

Enable delegation to work when pi_bridge + podman run on a remote machine (e.g. AWS ECS, remote Linux box) instead of localhost. Claude Code connects via MCP but agent containers run remotely.

**Local mode preserved** — remote is opt-in. `pi_start` without `repo_url` → current bind-mount behavior unchanged.

## Problem

Current design assumes pi_bridge runs as local stdio MCP server on same machine as Claude Code:
- Repo bind-mounted at `/context` (read-only) and `/workspace` (read-write worktree) — impossible remotely
- Sentinel files written to `/tmp/` — only reachable if local
- `podman` CLI called directly — must be installed locally
- Worktrees created at `/tmp/pi-worktrees/` — local path
- `pi_merge` does local git operations on the worktree

## Key change: container pulls repo with git porcelain

Remote container can't have local paths bind-mounted. Instead:

### Dockerfile changes
- Add `git` + credential tooling
- Inject credentials at runtime (SSH key via secret, or `GIT_TOKEN` env var)
- Entrypoint script:
  1. `git clone <REPO_URL> /workspace`
  2. `git checkout -b pi/<slug>`
  3. Start pi agent pointing at `/workspace`

### On agent_end (auto-push)
After agent finishes, container auto-commits and pushes:
```sh
git -C /workspace add -A
git -C /workspace commit -m "pi: agent changes from pi/<slug>"
git -C /workspace push origin pi/<slug>
```

### pi_merge on local machine
No worktree needed. `pi_merge` becomes:
```sh
git fetch origin pi/<slug>
git merge --no-ff origin/pi/<slug>
git push origin --delete pi/<slug>  # cleanup
```

## Other changes needed

### 1. Transport: HTTP MCP instead of stdio

pi_bridge already supports HTTP mode (`PI_BRIDGE_HTTP=1 PI_BRIDGE_PORT=3200`). Claude Code connects via `mcp__http` config pointing to remote host.

### 2. Sentinel file → HTTP status endpoint

Replace `/tmp/<name>.status` sentinel with HTTP polling:
- `pi_bridge` exposes `GET /api/status/<containerName>` returning `{done, error, ts}`
- Monitor polls the endpoint instead of watching a file

### 3. `podman` → remote container API

Wrap container lifecycle to dispatch to remote Docker API or ECS. Simplest MVP: SSH tunnel to remote Docker socket (`ssh -L /tmp/docker.sock:remote:/var/run/docker.sock`).

## Mode detection in pi_start

```
pi_start(workspace, task)              → local mode (bind-mount, worktree, sentinel file)
pi_start(repo_url, branch, task)       → remote mode (clone, auto-push, HTTP status)
```

`pi_merge` detects mode from saved state and uses the right merge strategy.

## Suggested MVP sequence

1. Dockerfile: add git + auto-push entrypoint script
2. `pi_start`: add `repo_url` + `branch` params; pass to container as env vars; save mode in state
3. `pi_merge`: branch on mode — worktree merge (local) vs git fetch+merge (remote)
4. pi_bridge HTTP mode: add `/api/status/<name>` endpoint
5. ECS task definition + Claude Code HTTP MCP config

## Dependencies

- Multi-instance support (`local-agent-pi-bridge-multi-instance`) recommended first
- Requires git credentials management strategy (SSH deploy key per repo, or token)
