/**
 * Mock board-tui MCP server for scanner tests.
 * Run as: node mock-board-tui-tests.js
 * ESM version (compatible with package "type": "module")
 */
import { createInterface } from "readline";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { writeFileSync } from "fs";

const TASKS_DIR = process.env.BOARD_TASKS_DIR || "/tmp/empty-tasks";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function respond(id, result) {
  writeLine({ jsonrpc: "2.0", id, result });
}

function errorResp(id, code, message) {
  writeLine({ jsonrpc: "2.0", id, error: { code, message } });
}

function listDelegatedTasks(statusFilter) {
  const tasks = [];
  try {
    const files = readdirSync(TASKS_DIR).filter(f => f.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(TASKS_DIR, f), "utf-8");
      const deMatch = content.match(/delegation_status:\s*(\w+)/);
      const slug = f.replace(/\.md$/, "");
      tasks.push({ slug, delegation_status: deMatch?.[1] ?? "none" });
    }
  } catch (e) {}
  return statusFilter
    ? tasks.filter(t => t.delegation_status === statusFilter)
    : tasks;
}

async function main() {
  // Send initialization response immediately on first output availability
  respond(1, {
    protocolVersion: "2024-11-05",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "mock-board-tui", version: "0.0.1" },
  });

  rl.on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.method === "tools/list" && msg.id != null) {
      respond(msg.id, {
        tools: [
          {
            name: "list_delegated_tasks",
            description: "List delegated tasks by status",
            inputSchema: { type: "object", properties: { status: { type: "string" } } },
          },
          {
            name: "set_frontmatter",
            description: "Update task card frontmatter",
            inputSchema: { type: "object", properties: { slug: { type: "string" }, key: { type: "string" }, value: { type: "string" } } },
          },
        ],
      });
      return;
    }

    if (msg.method === "tools/call" && msg.id != null) {
      const { name, arguments: args } = msg.params || {};
      if (name === "list_delegated_tasks") {
        const status = args?.status ?? "queued";
        const tasks = listDelegatedTasks(status);
        respond(msg.id, { content: [{ type: "text", text: JSON.stringify(tasks) }] });
      } else if (name === "set_frontmatter") {
        respond(msg.id, { content: [{ type: "text", text: JSON.stringify({ updated: true, slug: args?.slug }) }] });
      } else {
        errorResp(msg.id, -1, "unknown tool: " + name);
      }
      return;
    }

    if (msg.method === "ping" && msg.id != null) {
      respond(msg.id, {});
    }
  });

  process.on("SIGTERM", () => process.exit(0));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
