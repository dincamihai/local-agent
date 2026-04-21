import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { request } from "http";

// Mutable getters so tests can simulate env var changes on re-import
let _host = process.env.MEMORY_MCP_HOST ?? "host.docker.internal";
let _port = parseInt(process.env.MEMORY_MCP_PORT ?? "5101", 10);

export const getHost = (): string => _host;
export const getPort = (): number => _port;

export function setEnv(host?: string, port?: string) {
  _host = host ?? process.env.MEMORY_MCP_HOST ?? "host.docker.internal";
  _port = parseInt(port ?? process.env.MEMORY_MCP_PORT ?? "5101", 10);
}

let sessionId: string | undefined;
let initialized = false;

export function getSessionId(): string | undefined { return sessionId; }
export function resetTestState() { sessionId = undefined; initialized = false; }

export function mcpCall(
  method: string,
  params: Record<string, any>,
  id: number,
  host?: string,
  port?: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const h = host ?? getHost();
    const p = port ?? getPort();

    const req = request(
      { hostname: h, port: p, path: "/mcp", method: "POST", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          const sid = res.headers["mcp-session-id"];
          if (sid) sessionId = Array.isArray(sid) ? sid[0] : sid;

          // Parse SSE response
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
          // Plain JSON
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

export async function ensureInitialized() {
  if (!initialized) {
    await mcpCall("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-membrain-ext", version: "1.0" },
    }, 0);
    initialized = true;
    await mcpCall("notifications/initialized", {}, 0).catch(() => {});
  }
}

// Allow tests to call mcpCall directly without going through ensureInitialized
export async function callTool(name: string, args: Record<string, any>, skipInit = false): Promise<string> {
  if (!skipInit) await ensureInitialized();
  const result = await mcpCall("tools/call", { name, arguments: args }, Date.now());
  if (result?.content?.[0]?.text) return result.content[0].text;
  return JSON.stringify(result);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask",
    label: "Membrain Ask",
    description: "Ask membrain a question about anything it has learned. Returns a synthesized natural-language answer with sources. Use this when you need to recall past debugging sessions, incidents, decisions, team context, or any knowledge. Traverses its memory graph and synthesizes the answer using a local LLM.",
    parameters: Type.Object({
      query: Type.String({ description: "Your question in natural language" }),
      budget: Type.Optional(Type.Number({ description: "Retrieval depth (default 500, higher = more memories searched)" })),
      session_id: Type.Optional(Type.String({ description: "Current session ID (optional, for session-scoped ranking)" })),
    }),
    async execute(_id, params) {
      const args: Record<string, any> = { query: params.query };
      if (params.budget) args.budget = params.budget;
      if (params.session_id) args.session_id = params.session_id;
      const text = await callTool("ask", args);
      return { content: [{ type: "text", text }] };
    },
  });

  pi.registerTool({
    name: "store",
    label: "Membrain Store",
    description: "Tell membrain to remember something important. Use this when you discover a significant insight, decision, root cause, fix, or fact that should persist across sessions. Content goes through phi4-mini distillation — noise is filtered automatically. Use sparingly: only for genuinely valuable knowledge, not routine observations.",
    parameters: Type.Object({
      content: Type.String({ description: "The insight, decision, or fact to remember" }),
      source: Type.Optional(Type.String({ description: "Source tag (default: claude-insight)" })),
      session_id: Type.Optional(Type.String({ description: "Current session ID (optional)" })),
    }),
    async execute(_id, params) {
      const args: Record<string, any> = { content: params.content };
      if (params.source) args.source = params.source;
      if (params.session_id) args.session_id = params.session_id;
      const text = await callTool("store", args);
      return { content: [{ type: "text", text }] };
    },
  });
}
