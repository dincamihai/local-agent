---
column: Done
title: Create membrain extension to replace LanceDB memory backend
parent: local-agent-delegation-queue
---

# Create membrain extension to replace LanceDB memory backend

## Goal (DONE)

Create `membrain-extension.ts` so local-agent Docker containers can use membrain.

## Implemented

### 1. Membrain extension (local-agent/membrain-extension.ts)
- Copies lance-extension.ts structure but calls membrain tools directly
- Exposes `ask` tool → membrain's `ask` (query + budget + session_id)
- Exposes `store` tool → membrain's `store` (content + source + session_id)
- No mapping layer — native tool names only
- Defaults to port 5101
- Tests: 5/5 passing

### 2. Entrypoint wrapper (local-agent/entrypoint.sh)
- Reads `MEMORY_BACKEND` env var (default: lance)
- Loads `memory-extension.ts` or `membrain-extension.ts` accordingly

### 3. Dockerfile updated
- Copies both extensions + entrypoint.sh
- ENTRYPOINT → entrypoint.sh

### 4. Test coverage
- Unit tests: tool registration, param shapes, no lance-only tools (4 tests)
- Mock HTTP e2e: full JSON-RPC flow with mock server — initialize, session-id, ask, store (1 test)
- All pass: 5/5

## Usage

```bash
# Default (lance)
docker run local-agent --model gemma4 -p "..."

# Membrain
MEMORY_BACKEND=membrain docker run \
  -e MEMORY_BACKEND=membrain \
  local-agent --model gemma4 -p "..."
```

## Notes

- Extension talks directly to `host.docker.internal:5101/mcp` via HTTP JSON-RPC
- No separate bridge file needed — membrain's own MCP server handles the HTTP endpoint
- Operational follow-ups: systemd/launchd auto-start for membrain server, migration from lance
