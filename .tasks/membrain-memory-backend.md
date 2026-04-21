---
column: Backlog
title: Replace LanceDB memory with membrain as shared memory backend
---

# Replace LanceDB memory with membrain as shared memory backend
---
column: backlog
parent: local-agent-delegation-queue
depends_on: []
---

## Problem

`memory-extension.ts` currently talks to `memory-lance-mcp` (LanceDB vector store) on port 3100 via MCP-over-HTTP. Membrain uses Memgraph + vector search but runs its MCP server over stdio only (no HTTP endpoint).

## Goal

Wire local-agent Docker containers to use membrain's knowledge graph instead of LanceDB for memory recall/store.

## Current Architecture

```
pi agent (Docker)
  └── memory-extension.ts ──HTTP POST /mcp──→ memory-lance-mcp (host:3100)
```

Tools used by extension: `memory_recall`, `memory_store`, `memory_stats`, `memory_forget`, `memory_consolidate`, `memory_update`

## Membrain Side

- MCP server: `membrain serve` (stdio JSON-RPC) — tools: `store`, `ask`
- HTTP proxy: `proxy/server.js` (port 5100) — endpoints: `POST /add`, `POST /context`
- Host-side binary at: `/home/mihai/repos/membrain/target/release/membrain`
- Proxy runs on host, containers access via `host.docker.internal:5100`

## Tasks

### 1. Create MCP-over-HTTP wrapper for membrain

The stdio MCP server can't run inside containers (glibc mismatch). Need an HTTP-to-stdio bridge that:
- Exposes `initialize`, `tools/call`, `notifications/initialized` over HTTP POST
- Wraps `membrain serve` via stdio (spawn process, pipe stdin/stdout)
- Listens on configurable port (e.g. 5101) so it doesn't conflict with the simple proxy

### 2. Update `memory-extension.ts`

Map existing tool names to membrain's tools:
| Old Tool | Membrain Tool | Notes |
|----------|--------------|-------|
| `memory_recall` | `ask` | query → query, budget → budget |
| `memory_store` | `store` | text → content, add session_id |
| `memory_stats` | N/A | Implement as custom query against Memgraph, or skip |
| `memory_forget` | N/A | Membrain has no delete tool yet |
| `memory_consolidate` | N/A | Not available — merge → store new, skip for now |
| `memory_update` | `store` | Upsert by name (membrain dedupes on norm_name) |

### 3. Dockerfile / run config

- Set env var `MEMORY_MCP_HOST=host.docker.internal`, `MEMORY_MCP_PORT=5101`
- Start the HTTP bridge on host before docker run (or document as prerequisite)

### 4. Migration notes

- LanceDB data won't migrate automatically. New memories go to membrain.
- Stop `memory-lance-mcp` service once verified working.

## Files to modify

- `memory-extension.ts` — tool name mappings
- New: `proxy/mcp-http-bridge.js` — MCP-over-HTTP wrapper around `membrain serve` stdio
- `DESIGN.md` — update architecture diagram
