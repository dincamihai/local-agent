#!/bin/sh
set -e

if [ -z "$REPO_URL" ]; then
  # Local mode: delegate to original pi entrypoint
  MEMORY_BACKEND="${MEMORY_BACKEND:-lance}"
  exec pi --no-skills --no-prompt-templates -e "/ext/${MEMORY_BACKEND}-extension.ts" "$@"
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
