---
column: Backlog
title: Create membrain extension to replace LanceDB memory backend
parent: local-agent-delegation-queue
depends_on: []
---

# Create membrain extension to replace LanceDB memory backend

## Goal (DONE)

Create `membrain-extension.ts` and `mcp-http-bridge.js` so local-agent Docker containers can use membrain.

## Implemented

### 1. MCP-over-HTTP bridge (membrain/proxy/mcp-http-bridge.js)
- Wraps `membrain serve` via stdio (spawn process)
- Exposes MCP JSON-RPC over HTTP POST `/mcp`
- Supports: `initialize`, `tools/list`, `tools/call`, `notifications/initialized`
- Listens on port 5101 (configurable via MEMC_BRIDGE_PORT env var)
- Container access via `host.docker.internal:5101`
- Tests: 5/5 passing

### 2. Membrain extension (local-agent/membrain-extension.ts)
- Copies lance-extension.ts structure but calls membrain tools directly
- Exposes `ask` tool → membrain's `ask` (query + budget + session_id)
- Exposes `store` tool → membrain's `store` (content + source + session_id)
- No mapping layer — native tool names only
- Defaults to port 5101
- Tests: 4/4 passing

### 3. Entrypoint wrapper (local-agent/entrypoint.sh)
- Reads `MEMORY_BACKEND` env var (default: lance)
- Loads `memory-extension.ts` or `membrain-extension.ts` accordingly

### 4. Dockerfile updated
- Copies both extensions + entrypoint.sh
- ENTRYPOINT → entrypoint.sh

### 5. DESIGN.md updated
- New architecture diagram showing both backends
- Updated setup instructions for both options
- Files section updated

### 6. Test scripts added to package.json

## Usage

```bash
# Default (lance)
docker run local-agent --model gemma4 -p "..."

# Membrain
MEMORY_BACKEND=membrain docker run \
  -e MEMORY_BACKEND=membrain \
  local-agent --model gemma4 -p "..."
```

## Remaining

- [ ] Start bridge service (node proxy/mcp-http-bridge.js) before docker run
- [ ] Test end-to-end with real docker container
- [ ] Add bridge to systemd/launchd service for auto-start
- [ ] Consider: stop memory-lance-mcp once fully migrated
