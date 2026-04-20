# local-agent

MCP bridge that lets Claude Code delegate tasks to a local [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) running in Docker with [Ollama](https://ollama.com/) models (qwen3, gemma, phi4, deepseek-r1, etc.).

Pairs with [board-tui](https://github.com/dincamihai/board-tui) — the `delegate` skill consumes `.tasks/*.md` cards, the agent updates them when done.

## Architecture

```
Claude Code (MCP client)
  │
  │  pi_prompt_and_wait("review this code")
  │  pi_steer("focus on error handling")
  │  pi_state()
  ▼
pi-bridge-mcp.ts  (MCP server, stdio or HTTP)
  │
  │  JSONL-RPC over stdin/stdout
  ▼
pi-coding-agent  (Docker container)
  ├─ tools: read, write, bash, grep, find
  ├─ memory-extension ──HTTP──▶ memory-lance-mcp (host:3100)
  └─ inference ──HTTP──────────▶ ollama (host:11434)
```

## Prerequisites

| Dependency | Purpose |
|------------|---------|
| [Ollama](https://ollama.com/) | Local LLM inference (gemma4, etc.) |
| Docker (or [Colima](https://github.com/abiosoft/colima)) | Container runtime for the pi agent |
| Node.js 20+ | Runs the MCP server |
| [memory-lance-mcp](https://github.com/nicobailon/memory-lance-mcp) (optional) | Long-term memory over HTTP on port 3100 |

## Setup

### 1. Build the Docker image

```bash
docker build -t local-agent .
```

### 2. Install MCP server dependencies

```bash
npm install
```

### 3. Pull an Ollama model

```bash
ollama pull qwen3.6
```

### 4. Configure as MCP server in Claude Code

Add to your Claude Code MCP config (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "pi_bridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/path/to/local-agent/pi-bridge-mcp.ts"]
    }
  }
}
```

Or register via the CLI:

```bash
claude mcp add pi_bridge -- npx tsx /path/to/local-agent/pi-bridge-mcp.ts
```

### 5. Environment variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_DOCKER_IMAGE` | `local-agent` | Docker image name |
| `PI_MODEL` | `qwen3.6:latest` | Default Ollama model |
| `PI_LOCAL_AGENT_DIR` | _script directory_ | Path to this repo (mounts `pi-models.json`, `pi-settings.json`, `memory-extension.ts` into container) |
| `PI_OUTPUT_DIR` | `$PI_LOCAL_AGENT_DIR/output` | Host dir mounted at `/output` for agent artifacts |
| `PI_BRIDGE_HTTP` | unset | Set to `1` for HTTP transport instead of stdio |
| `PI_BRIDGE_PORT` | `3200` | HTTP port (when `PI_BRIDGE_HTTP=1`) |

## MCP Tools

Once configured, Claude Code gets these tools:

| Tool | Description |
|------|-------------|
| `pi_start` | Launch pi agent in Docker (optional workspace mount) |
| `pi_stop` | Kill the container |
| `pi_prompt` | Send a task (async — use `pi_wait` + `pi_result`) |
| `pi_prompt_and_wait` | Send a task and block until done |
| `pi_steer` | Redirect the agent mid-task |
| `pi_follow_up` | Queue work after current task finishes |
| `pi_abort` | Kill current operation |
| `pi_wait` | Block until agent is idle |
| `pi_result` | Get last assistant output |
| `pi_state` | Get agent state (model, streaming status, etc.) |
| `pi_set_model` | Switch Ollama models mid-session |
| `pi_compact` | Compact the agent's context window |

## Available Models

Configured in `pi-models.json`. All served via Ollama on `host.docker.internal:11434`:

| Model | Context | Reasoning |
|-------|---------|-----------|
| `qwen3.6:latest` (default) | 128K | Yes |
| `qwen3:8b` | 128K | Yes |
| `gemma4:26b` | 128K | Yes |
| `phi4:latest` | 128K | No |
| `deepseek-r1:7b` | 128K | Yes |
| `ministral-3:3b` | 128K | No |

Switch models at runtime: `pi_set_model("phi4:latest")`.

## Files

```
├── pi-bridge-mcp.ts      # MCP server — the bridge between Claude and pi
├── memory-extension.ts    # Pi extension: memory tools over HTTP
├── Dockerfile             # node:20-slim + pi + configs baked in
├── pi-settings.json       # Default model/provider (qwen3.6/ollama)
├── pi-models.json         # Ollama provider + model registry
├── package.json           # MCP SDK + zod dependencies
├── DESIGN.md              # Detailed architecture and design notes
└── output/                # Agent output directory (gitignored)
```

## Usage Example

From Claude Code, once the MCP is connected:

```
# Start the agent with a workspace mounted
pi_start({ workspace: "/path/to/project" })

# Send a task and wait for completion
pi_prompt_and_wait({ message: "Review all Go files for error handling issues" })

# Steer mid-task
pi_steer({ message: "Also check for nil pointer dereferences" })

# Get the result
pi_result()

# Stop when done
pi_stop()
```

## Using with board-tui

[board-tui](https://github.com/dincamihai/board-tui) is a Textual TUI kanban
for `.tasks/*.md` markdown cards. local-agent's `delegate` skill is built to
consume that format — one card is one delegation unit.

End-to-end flow:

1. **Create a task card** in `.tasks/<slug>.md` — via the board-tui UI, its
   `board-tui-mcp` server, or by hand. Card has YAML frontmatter (`column`,
   `order`) and a body with definition of done.
2. **Invoke `/delegate`** in Claude Code. The skill:
   - Moves the card to `In Progress`
   - Calls `pi_start` with `workspace: <repo>` and `task: .tasks/<slug>.md`
   - `pi_start` auto-creates a `pi/<slug>-<ts>` git worktree so agent edits
     stay isolated from `main`
3. **Agent works** in the container. `/task.md` is read-write, `/workspace`
   is the worktree, `/context` is the repo read-only.
4. **Agent finishes**: updates card frontmatter to `column: Done`, appends a
   `## Result` section summarising what it did.
5. **Claude calls `pi_merge`** — commits uncommitted edits, merges worktree
   branch into `main`, removes worktree. Then `pi_stop` cleans up container.
6. **board-tui refreshes** (`r`) and the card appears in `Done`.

Register both MCP servers in Claude Code:

```bash
claude mcp add pi_bridge    -- npx tsx /path/to/local-agent/pi-bridge-mcp.ts
claude mcp add board-local  -- board-tui-mcp
```

Symlink the Claude Code skills:

```bash
ln -s /path/to/board-tui/skills/task-cards ~/.claude/skills/task-cards
ln -s /path/to/local-agent/skills/delegate ~/.claude/skills/delegate
```

## License

MIT
