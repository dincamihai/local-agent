---
column: Backlog
---

---
column: Backlog
---

# Remote agent: run pi_bridge on separate machine (AWS ECS)

## Goal

Enable delegation to work when pi_bridge + podman run on a remote machine instead of localhost.

## What is ALREADY DONE

Core remote delegation mode implemented:

1. **`pi_start` supports `repo_url` + `repo_branch`** — REMOTE_DELEGATION env mode
2. **Dockerfile** — git + openssh-client installed
3. **entrypoint.sh** — clones repo → creates branch → runs pi agent → auto-commits + pushes on exit
4. **Credential mounts** — podman secret (`gh-token`) + SSH agent socket forwarding
5. **`pi_start` HTTP transport** — `PI_BRIDGE_HTTP=1 PI_BRIDGE_PORT=3200` for remote MCP connections
6. **Multi-instance support** — `instances` Map handles concurrent agents

## Remaining (2 items)

### 1. HTTP status endpoint (replacing sentinel files)

Current: pi-bridge writes `/tmp/<containerName>.status` JSON file on agent_end.
Remote problem: file only exists on remote host, Claude Code can't read it.

Change: expose `GET /api/status/<containerName>` on pi-bridge HTTP server:
```
GET /api/status/pi-remote-123456
→ { done: true, error: null, ts: 1234567890 }
```
- Store status in-memory Map keyed by containerName
- Update on `onAgentEnd` callback
- Poll endpoint from Claude Code instead of `until [ -f /tmp/... ]`

### 2. Remote `pi_merge` strategy

Current: `pi_merge` only knows worktree merge (local mode).
Remote mode needs git fetch+merge:
```sh
git fetch origin pi/<branch>
git merge --no-ff origin/pi/<branch>
git push origin --delete pi/<branch>  # cleanup
```
- Detect mode from saved state (repo_url present = remote)
- Branch in `pi_merge` MCP tool handler

## How it works in AWS ECS

```
┌─────────────────────────────────────────────────────────────┐
│  AWS ECS Task (Fargate or EC2)                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  pi-bridge MCP server (HTTP mode)                   │    │
│  │  ┌───────────────────────────────────────────────┐  │    │
│  │  │  pi agent container (pi-remote-*)               │  │    │
│  │  │  • git clone REPO_URL /workspace                │  │    │
│  │  │  • git checkout -b pi/<slug>                    │  │    │
│  │  │  • runs pi agent with task prompt                │  │    │
│  │  │  • auto-commit + push on exit                    │  │    │
│  │  └───────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
│  Port 3200 (PI_BRIDGE_PORT) exposed via ALB / NLB            │
└─────────────────────────────────────────────────────────────┘
         ↑
         │ HTTP MCP (SSE)
         │
┌─────────────────────────────────────────────────────────────┐
│  Local machine (Claude Code)                                │
│  ~/.claude/settings.json:                                   │
│  { "mcpServers": {                                          │
│      "pi-bridge": {                                        │
│        "url": "https://ecs-task.example.com/mcp"           │
│      }                                                     │
│    }                                                       │
│  }                                                          │
│  • No podman needed locally                                 │
│  • No repo bind-mounts                                      │
│  • pi_merge fetches remote branch instead of worktree       │
└─────────────────────────────────────────────────────────────┘
```

### ECS-specific notes

- **Task definition**: 1 container (pi-bridge) with Docker-in-Docker or privileged mode for sibling containers
- **Networking**: ALB → ECS service on port 3200
- **Auth**: API key header or VPC-only access (no public internet)
- **Storage**: EFS for `/tmp/pi-worktrees/` if needed, but remote mode doesn't use worktrees
- **Credentials**: Secrets Manager → podman secret `gh-token`; or IAM role for CodeCommit
- **Scaling**: Service auto-scaling on queue depth

## Suggested order

1. HTTP status endpoint (`/api/status/<name>`)
2. Remote `pi_merge` branch
3. ECS task definition template
4. Claude Code MCP HTTP config helper

## Dependencies

- HTTP transport mode already works (`PI_BRIDGE_HTTP=1`)
- Multi-instance support already exists
- Credential strategy (podman secret + SSH agent) already implemented
