import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { request } from "http";

const MCP_HOST = process.env.MEMORY_MCP_HOST ?? "host.docker.internal";
const MCP_PORT = parseInt(process.env.MEMORY_MCP_PORT ?? "3100", 10);

let sessionId: string | undefined;

function mcpCall(method: string, params: Record<string, any>, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const req = request(
      { hostname: MCP_HOST, port: MCP_PORT, path: "/mcp", method: "POST", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          // Capture session ID from response
          const sid = res.headers["mcp-session-id"];
          if (sid) sessionId = Array.isArray(sid) ? sid[0] : sid;

          // Parse SSE response — look for data lines
          const lines = data.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.result) return resolve(parsed.result);
                if (parsed.error) return reject(new Error(parsed.error.message));
              } catch {}
            }
          }
          // Try parsing as plain JSON
          try {
            const parsed = JSON.parse(data);
            if (parsed.result) return resolve(parsed.result);
            if (parsed.error) return reject(new Error(parsed.error.message));
          } catch {}
          resolve(data);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function ensureInitialized() {
  if (!sessionId) {
    await mcpCall("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-memory-ext", version: "1.0" },
    }, 0);
    await mcpCall("notifications/initialized", {}, 0).catch(() => {});
  }
}

async function callTool(name: string, args: Record<string, any>): Promise<string> {
  await ensureInitialized();
  const result = await mcpCall("tools/call", { name, arguments: args }, Date.now());
  if (result?.content?.[0]?.text) return result.content[0].text;
  return JSON.stringify(result);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "memory_recall",
    label: "Memory Recall",
    description: "Search long-term memory for relevant information. Use this to recall facts, preferences, project context, or anything previously stored.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 5)", default: 5 })),
      category: Type.Optional(Type.String({ description: "Filter: profile, preferences, entities, events, cases, patterns" })),
    }),
    async execute(_id, params) {
      const args: Record<string, any> = { query: params.query };
      if (params.limit) args.limit = params.limit;
      if (params.category) args.category = params.category;
      const text = await callTool("memory_recall", args);
      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "memory_store",
    label: "Memory Store",
    description: "Store new information as a long-term memory.",
    parameters: Type.Object({
      text: Type.String({ description: "Information to remember" }),
      category: Type.Optional(Type.String({ description: "Category: profile, preferences, entities, events, cases, patterns" })),
      importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default 0.7)" })),
    }),
    async execute(_id, params) {
      const args: Record<string, any> = { text: params.text };
      if (params.category) args.category = params.category;
      if (params.importance !== undefined) args.importance = params.importance;
      const text = await callTool("memory_store", args);
      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "memory_stats",
    label: "Memory Stats",
    description: "Get memory database statistics — total count, categories, tiers.",
    parameters: Type.Object({}),
    async execute() {
      const text = await callTool("memory_stats", {});
      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "memory_forget",
    label: "Memory Forget",
    description: "Delete a memory by ID or search query.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Memory UUID or prefix" })),
      query: Type.Optional(Type.String({ description: "Search query to find memory to delete" })),
    }),
    async execute(_id, params) {
      const args: Record<string, any> = {};
      if (params.id) args.id = params.id;
      if (params.query) args.query = params.query;
      const text = await callTool("memory_forget", args);
      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "memory_consolidate",
    label: "Memory Consolidate",
    description: "Merge multiple memories into one. Provide source IDs and new consolidated text.",
    parameters: Type.Object({
      source_ids: Type.Array(Type.String(), { description: "IDs of memories to merge (min 2)" }),
      text: Type.String({ description: "New consolidated memory text" }),
      category: Type.Optional(Type.String({ description: "Category for new memory" })),
      importance: Type.Optional(Type.Number({ description: "Importance 0-1" })),
    }),
    async execute(_id, params) {
      const args: Record<string, any> = { source_ids: params.source_ids, text: params.text };
      if (params.category) args.category = params.category;
      if (params.importance !== undefined) args.importance = params.importance;
      const text = await callTool("memory_consolidate", args);
      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "memory_update",
    label: "Memory Update",
    description: "Update an existing memory's text, importance, or category.",
    parameters: Type.Object({
      id: Type.String({ description: "Memory UUID or prefix" }),
      text: Type.Optional(Type.String({ description: "New text (triggers re-embedding)" })),
      importance: Type.Optional(Type.Number({ description: "New importance 0-1" })),
      category: Type.Optional(Type.String({ description: "New category" })),
    }),
    async execute(_id, params) {
      const args: Record<string, any> = { id: params.id };
      if (params.text) args.text = params.text;
      if (params.importance !== undefined) args.importance = params.importance;
      if (params.category) args.category = params.category;
      const text = await callTool("memory_update", args);
      return { content: [{ type: "text", text }] };
    },
  });
}
