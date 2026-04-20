---
column: Backlog
parent: local-agent-remote-execution
part: 1/4
---

# Remote agent: Dockerfile git + entrypoint script
## Goal

Extend Dockerfile and add entrypoint script for remote mode — container clones repo, checks out branch, runs pi agent, then auto-pushes changes on exit.

## Changes

### Dockerfile
Add to existing `FROM node:20-slim` image:
```dockerfile
RUN apt-get install -y git
```
Copy entrypoint script:
```dockerfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
```
Override entrypoint (only for remote mode — keep existing ENTRYPOINT as fallback via env var check):
```dockerfile
ENTRYPOINT ["/entrypoint.sh"]
```

### entrypoint.sh
```sh
#!/bin/sh
set -e

if [ -z "$REPO_URL" ]; then
  # Local mode: delegate to original pi entrypoint
  exec pi --no-skills --no-prompt-templates -e /ext/memory-extension.ts "$@"
fi

# Remote mode: clone repo, checkout branch, run agent, auto-push on exit
BRANCH="${REPO_BRANCH:-pi/remote-$(date +%s)}"

git clone "$REPO_URL" /workspace
cd /workspace
git checkout -b "$BRANCH"

# Configure git identity for commits
git config user.email "pi-agent@local"
git config user.name "pi agent"

# Run pi agent (args passed through)
pi --no-skills --no-prompt-templates -e /ext/memory-extension.ts "$@"
EXIT_CODE=$?

# Auto-push changes
git add -A
git diff --cached --quiet || git commit -m "pi: agent changes from $BRANCH"
git push origin "$BRANCH"

exit $EXIT_CODE
```

### Credential injection
- `GIT_TOKEN` env var → configure git credential helper:
  ```sh
  git config --global credential.helper '!f() { echo "password=$GIT_TOKEN"; }; f'
  ```
- Or SSH key: mount at `/root/.ssh/id_rsa` via Docker secret

## Notes
- Local mode unchanged: no `REPO_URL` env var → original behavior
- `/workspace` already used by local mode (worktree mount) — remote mode sets it via clone
- `REPO_BRANCH` should be passed by pi_bridge as `pi/<slug>`

## Part of
`local-agent-remote-execution` — subtask 1/4
