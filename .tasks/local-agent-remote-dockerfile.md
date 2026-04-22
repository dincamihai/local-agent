---
column: Done
parent: local-agent-remote-execution
part: 1/4
updated: true
---

# Remote agent: Dockerfile git + entrypoint script
## Goal

Extend Dockerfile and add entrypoint script for remote mode — container clones repo, checks out branch, runs pi agent, then auto-pushes changes on exit.

## Approach

TDD — tests first, then implementation.

## Configuration

`REMOTE_DELEGATION` env var in MCP server config (`~/.claude/settings.json`):
- `"REMOTE_DELEGATION": ""` (default) → local mode: `workspace` param shown, `repo_url` hidden
- `"REMOTE_DELEGATION": "1"` → remote mode: `repo_url` param shown, `workspace` hidden

## Changes

### pi-bridge-mcp.ts — `pi_start` schema

When `REMOTE_DELEGATION` is set:
```ts
{
  repo_url: z.string().describe("Git repository URL to clone"),
  repo_branch: z.string().optional().describe("Branch name (default: pi/remote-<timestamp>)"),
  task: z.string().optional(),
}
```

When not set:
```ts
{
  workspace: z.string().describe("Host repo directory — mounted read-only at /context"),
  task: z.string().optional(),
  editdir: z.string().optional(),
}
```

Mutually exclusive — only one mode active per MCP server instance.

### Dockerfile
Add to existing `FROM node:20-slim` image:
```dockerfile
RUN apt-get install -y git openssh-client
```

`entrypoint.sh` already copied (line 13). No Dockerfile changes needed beyond git + ssh.

### entrypoint.sh

Credential detection order:
1. Podman secret `/run/secrets/gh-token` → git credential helper with token
2. SSH agent socket at `SSH_AUTH_SOCK` → use SSH for clone/push
3. No credentials → clone fails, agent can't push

```sh
#!/bin/sh
set -e

if [ -z "$REPO_URL" ]; then
  # Local mode: delegate to original pi entrypoint
  exec pi --no-skills --no-prompt-templates -e "/ext/${MEMORY_BACKEND:-lance}-extension.ts" "$@"
fi

# Remote mode: clone repo, checkout branch, run agent, auto-push on exit
BRANCH="${REPO_BRANCH:-pi/remote-$(date +%s)}"

# Credential setup (token takes priority)
if [ -f /run/secrets/gh-token ]; then
  git config --global credential.helper '!f() { echo "password=$(cat /run/secrets/gh-token)"; }; f'
elif [ -n "$SSH_AUTH_SOCK" ]; then
  # SSH agent socket forwarded — git will use it automatically for SSH URLs
  : # no-op, SSH agent handles auth
fi

git clone "$REPO_URL" /workspace
cd /workspace
git checkout -b "$BRANCH"

# Configure git identity for commits
git config user.email "pi-agent@local"
git config user.name "pi agent"

# Run pi agent (args passed through)
pi --no-skills --no-prompt-templates -e "/ext/${MEMORY_BACKEND:-lance}-extension.ts" "$@"
EXIT_CODE=$?

# Auto-push changes
git add -A
git diff --cached --quiet || git commit -m "pi: agent changes from $BRANCH"
git push origin "$BRANCH"

exit $EXIT_CODE
```

### Credential options

| Method | How | Security |
|--------|-----|----------|
| **Podman secret + token** | `podman secret create gh-token ~/.github_token`; mounted at `/run/secrets/gh-token` | Best. Token never in env, image layers, or `podman inspect`. |
| **SSH agent forwarding** | Mount `$SSH_AUTH_SOCK` into container; `SSH_AUTH_SOCK` env set | Best for SSH keys. Key never enters container filesystem. |

### Setting up the Podman secret

Create the secret once on the host machine:
```bash
# Create secret from file
echo "ghp_xxxxxxxxxxxx" > ~/.github_token
podman secret create gh-token ~/.github_token

# Verify it exists
podman secret ls

# Remove source file (optional but recommended)
rm ~/.github_token

# To update the secret later
podman secret rm gh-token
podman secret create gh-token ~/.github_token
```

The secret is stored in Podman's secret store (`~/.local/share/containers/storage/secrets/`) and mounted into the container at `/run/secrets/gh-token` at runtime.

### pi_start mounts

Always try both in container run:
```ts
// Secret mount (token)
mounts.push("--secret", "gh-token");

// SSH agent mount (socket)
if (process.env.SSH_AUTH_SOCK) {
  mounts.push("-v", `${process.env.SSH_AUTH_SOCK}:/ssh-agent`);
  envVars.push("SSH_AUTH_SOCK=/ssh-agent");
}
```

Entrypoint picks whichever credential works. No per-run config needed.

## Tests to write first (TDD)

1. **REMOTE_DELEGATION not set** → `repo_url` param not in schema, `workspace` shown
2. **REMOTE_DELEGATION set** → `workspace` param not in schema, `repo_url` mandatory
3. **Both workspace + repo_url passed** → error (mutually exclusive)
4. **Neither workspace nor repo_url** → error (one required)
5. **Remote mode mounts** → no repo mount, only output + credentials
6. **Entrypoint local mode** → no REPO_URL → delegates to pi
7. **Entrypoint remote mode** → REPO_URL set → clones, branches, runs, pushes
8. **Credential priority** → token secret used before SSH agent

## Files

- `pi-bridge-mcp.test.ts` — TDD tests for remote mode logic
- `Dockerfile` — add git + openssh-client
- `entrypoint.sh` — handle REPO_URL remote mode
- `pi-bridge-mcp.ts` — REMOTE_DELEGATION config, schema switching

## Notes
- Local mode unchanged: no `REPO_URL` env var → original behavior
- `/workspace` used by both modes (local worktree mount or clone target)
- `REPO_BRANCH` passed by pi_bridge as `pi/<slug>`
- Both credential methods mounted on every container start — entrypoint auto-detects

## Part of
`local-agent-remote-execution` — subtask 1/4
