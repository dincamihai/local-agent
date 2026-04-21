# Local Agent for gemma4 Task Delegation

## Context

Claude delegates heavy-lifting tasks to a local gemma4 model via ollama. For file-heavy
tasks (reviewing notes, scanning code), Claude had to read all files and paste them into
prompts. This Docker-based agent gives gemma4 full tool access (read, write, bash) AND
access to long-term memory, so it can work independently with context — not just
blindly processing text.

## Architecture

```
Claude ──docker run──▶ [Container: pi agent + gemma4]
       │                  │  tools: read, write, bash, grep, find
       │                  │  memory: ask, store (membrain) or memory_recall, etc. (lance)
       │                  │  reads /workspace (mounted RO)
       │                  │  writes /output (mounted RW)
       │                  │  inference: host ollama via host.docker.internal:11434
       │                  │  memory: host MCP bridge via host.docker.internal:5101
       │                  └── OR host memory-lance-mcp via host.docker.internal:3100
       ▼
Claude ◀──reads output──┘
```

### Key components

- **gemma4** runs on host via ollama (Metal GPU on macOS)
- **pi** (`@mariozechner/pi-coding-agent`) — lightweight coding agent inside Docker
- **membrain MCP bridge** runs on host in HTTP mode (port 5101), MCP-over-HTTP wrapper around `membrain serve` stdio
- **memory-lance-mcp** runs on host in HTTP mode (port 3100), alternative memory backend
- **Swappable memory extension** — lance-extension.ts or membrain-extension.ts, selected via `MEMORY_BACKEND` env var
- **Sandboxed** — only mounted folders are accessible, memory access is read/write

### Why memory matters for delegation

Without memory, gemma4 is a blank slate — it doesn't know who's on the team, what
projects are active, or what conventions to follow. With memory access, the Docker agent
can:

- Recall context about people mentioned in notes (roles, preferences, history)
- Look up project patterns and conventions before reviewing code
- Pull relevant history when drafting summaries or 1-1 prep
- Store findings for future sessions

Memory turns delegation from "process this text" into "do this task with context."

## Setup

### Prerequisites

1. **ollama** running on host with gemma4 loaded
2. **Memory backend** (choose one):

   **Option A: Membrain** (recommended, graph-based memory)
   - Memgraph running (`docker compose up -d` in `/home/mihai/repos/membrain/`)
   - `membrain init` run (once)
   - MCP bridge running on port 5101:
     ```bash
     cd /home/mihai/repos/membrain
     node proxy/mcp-http-bridge.js 5101
     ```
   - `MEMORY_BACKEND=membrain` set when running Docker container

   **Option B: memory-lance-mcp** (legacy, vector-only)
   ```
   ~/Library/LaunchAgents/com.memory-lance-mcp.http.plist
   ```
   This is separate from the stdio instance Claude uses directly. It auto-starts on
   login and restarts on crash. Logs: `~/.memory-mcp-http.log`.

   Commands:
   ```bash
   # Check status
   curl -s http://localhost:3100/health

   # Stop
   launchctl unload ~/Library/LaunchAgents/com.memory-lance-mcp.http.plist

   # Start
   launchctl load ~/Library/LaunchAgents/com.memory-lance-mcp.http.plist

   # Logs
   tail -f ~/.memory-mcp-http.log
   ```
3. **Docker image** built:
   ```bash
   docker build -t local-agent /path/to/local-agent/
   ```

### Config files

| File | Purpose |
|------|---------|
| `pi-settings.json` | Sets gemma4 as default model/provider |
| `pi-models.json` | Registers ollama at `host.docker.internal:11434/v1` |
| `memory-extension.ts` | Pi extension: memory-lance-mcp tools over HTTP (port 3100) |
| `membrain-extension.ts` | Pi extension: membrain MCP tools over HTTP (port 5101) |
| `entrypoint.sh` | Wrapper: selects extension based on `MEMORY_BACKEND` env var |

These are baked into the Docker image.

### Invocation

```bash
docker run --rm \
  -v "<input-folder>:/workspace:ro" \
  -v "/path/to/local-agent/output:/output" \
  --add-host=host.docker.internal:host-gateway \
  local-agent \
  --model gemma4 --no-session --tools read,write,bash \
  -p "<task prompt>"
```

Default: lance memory backend (port 3100). To use membrain:

```bash
docker run --rm \
  -e MEMORY_BACKEND=membrain \
  -v "<input-folder>:/workspace:ro" \
  -v "/path/to/local-agent/output:/output" \
  --add-host=host.docker.internal:host-gateway \
  local-agent \
  --model gemma4 --no-session --tools read,write,bash \
  -p "<task prompt>"
```

The agent gets memory tools based on the active extension: `ask`/`store` for membrain, `memory_recall`/etc for lance.

### Important notes

- **Colima**: only `$HOME` paths work as volume mounts. Don't use `/tmp`.
- **Unix sockets don't cross** Colima's VM boundary — use TCP (`host.docker.internal`) instead.
- **Memory server must be running** in HTTP mode before starting the Docker agent.
- **Tools**: pi supports read, write, bash, edit, grep, find, ls — enable what you need via `--tools`.
- **Memory tool names change** by backend: membrain exposes `ask`/`store`, lance exposes `memory_recall`/etc.

## Three delegation tiers

| Tier | When | How | Cost |
|------|------|-----|------|
| **Direct MCP** | Claude has the content, quick one-shot | `mcp__ollama__run` / `mcp__ollama__chat_completion` | Free |
| **Docker agent** | Needs file access, multi-step, benefits from memory context | `docker run local-agent` | Free |
| **Claude subagent** | Complex judgment, accuracy-critical, needs Claude's full tool suite | `Agent` tool | API tokens |

### When to use Docker agent

- Task needs reading >2-3 files that Claude hasn't loaded
- Task benefits from memory context (people, projects, patterns)
- Task is primarily about understanding/generating language, not pattern matching
- Examples: weekly note review, code review across a directory, 1-1 prep, drafting

### When NOT to use Docker agent

- Quick one-shot where Claude already has the content → Direct MCP
- Pattern extraction, data lookup → Grep/regex
- Accuracy-critical decisions → Claude subagent
- Very short output (< 1 paragraph) → Not worth the overhead

## Files

```
local-agent/
├── Dockerfile              # node:20-slim + pi + both extensions
├── pi-settings.json        # default model/provider
├── pi-models.json          # ollama provider config (host.docker.internal)
├── memory-extension.ts     # pi extension: memory-lance-mcp tools over HTTP
├── membrain-extension.ts   # pi extension: membrain MCP tools over HTTP
├── entrypoint.sh           # selects extension based on MEMORY_BACKEND
├── .gitignore              # ignores output/
├── DESIGN.md               # this file
└── output/                 # mount target for results (gitignored)
```

### Membrain side

```
membrain/
├── proxy/
│   ├── server.js          # simple REST proxy (/add, /context, port 5100)
│   ├── mcp-http-bridge.js # MCP-over-HTTP wrapper (port 5101)
│   └── mcp-http-bridge.test.js
├── target/release/membrain # Rust binary (stdio MCP server)
└── docker-compose.yml      # Memgraph
```

## Build

```bash
docker build -t local-agent /path/to/local-agent/
```

## MCP Bridge (pi-bridge-mcp)

An MCP server that wraps pi-coding-agent's RPC mode, giving Claude native tool
access to control the local agent — start, prompt, steer, abort, check state.

### Architecture

```
Claude Code
  │
  │ mcp__pi_bridge__pi_prompt_and_wait("review this code")
  │ mcp__pi_bridge__pi_steer("focus on error handling")
  │ mcp__pi_bridge__pi_state()
  ▼
pi-bridge MCP server (stdio, host-side)
  │
  │ JSONL over stdin/stdout (--mode rpc)
  ▼
pi-agent (Docker container)
  ├─ tools: read, write, bash, grep, find
  ├─ memory-extension ──HTTP──→ memory-lance-mcp (host:3100)   [MEMORY_BACKEND=lance]
  │   OR
  ├─ membrain-extension ──HTTP→ mcp-http-bridge (host:5101) → membrain serve (stdio)
  └─ inference ──HTTP────────→ ollama/gemma4 (host:11434)
```

### MCP Tools

| Tool | Purpose |
|------|---------|
| `pi_start` | Launch pi agent in Docker (optional workspace mount) |
| `pi_stop` | Kill the container |
| `pi_prompt` | Send a task (async, use pi_wait + pi_result) |
| `pi_prompt_and_wait` | Send a task and block until done (simple path) |
| `pi_steer` | Redirect the agent mid-task |
| `pi_follow_up` | Queue work after current task finishes |
| `pi_abort` | Kill current operation |
| `pi_wait` | Block until agent is idle |
| `pi_result` | Get last assistant text |
| `pi_state` | Get agent state (model, streaming, etc.) |
| `pi_set_model` | Switch models mid-session |
| `pi_compact` | Compact context window |

### Config

The MCP server is registered in `~/.claude.json` under `mcpServers`:

```json
{
  "pi_bridge": {
    "command": "npx",
    "args": ["tsx", "/path/to/local-agent/pi-bridge-mcp.ts"]
  }
}
```

### Prerequisites

Same as before (ollama + gemma4, Docker image built), plus one of:

- **membrain**: MCP bridge running on port 5101 (`node proxy/mcp-http-bridge.js`)
- **memory-lance-mcp**: HTTP service running on port 3100

Plus:
```bash
cd /path/to/local-agent && npm install
```

### Comparison: Fire-and-forget vs MCP Bridge

| | Fire-and-forget (`-p`) | MCP Bridge (`--mode rpc`) |
|---|---|---|
| Control | None after launch | Full: steer, abort, follow-up |
| Visibility | Read output file after done | State, streaming status, result |
| Chaining | New container per task | Follow-up in same session |
| Model switching | Fixed at launch | Change mid-session |
| Context | Lost between tasks | Persists across prompts |
