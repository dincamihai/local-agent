---
column: Backlog
---

# Membrain extension transport tests

HTTP transport, SSE parsing, session init — completely untested.

## What to test

- `mcpCall()`: HTTP request construction, SSE response parsing (`data:` prefix), plain JSON fallback, error response rejection, connection refused, timeout
- `ensureInitialized()`: first call triggers `initialize` + `notifications/initialized`, subsequent calls skip, session ID header propagation
- `callTool()`: extracts `result.content[0].text`, falls back to `JSON.stringify` for non-text results
- Tool execute functions: `ask` with optional `budget`/`session_id`, `store` with optional `source`/`session_id`
- `MCP_HOST`/`MCP_PORT` env var overrides

## Approach

Mock HTTP responses. Test SSE parsing with realistic multi-line data.

## Queue

ID: 31afbd06-bc89-41c8-bbcd-4c3b4408842b
