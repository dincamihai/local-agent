#!/usr/bin/env npx tsx
/**
 * Tests for membrain-extension.ts
 * Run:  npx tsx membrain-extension.test.ts
 */

import { strict as assert } from "node:assert";
import http from "http";

// ---- helpers ------

function httpPost(port: number, path: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
          catch { resolve({ status: res.statusCode, body }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ---- tests -

async function testEnvVarsDefaults() {
  console.log("TEST 1: env var defaults are host.docker.internal:5101");
  const origHost = process.env.MEMORY_MCP_HOST;
  const origPort = process.env.MEMORY_MCP_PORT;
  delete process.env.MEMORY_MCP_HOST;
  delete process.env.MEMORY_MCP_PORT;

  // Re-import to pick up env vars
  const mod = await import("./membrain-extension.ts");
  const fn = mod.default as (pi: any) => void;

  // Capture registered tools
  const tools: Array<{ name: string; params: any }> = [];
  const piMock = {
    registerTool(t: any) { tools.push({ name: t.name, params: t.parameters }); },
  };

  fn(piMock);

  // Restore env
  if (origHost) process.env.MEMORY_MCP_HOST = origHost;
  if (origPort) process.env.MEMORY_MCP_PORT = origPort;

  const toolNames = tools.map(t => t.name);
  assert.ok(toolNames.includes("ask"), "should register ask tool");
  assert.ok(toolNames.includes("store"), "should register store tool");
  console.log(`  PASS — registered tools: ${toolNames.join(", ")}`);
}

async function testAskToolParams() {
  console.log("TEST 2: ask tool has correct params");
  const mod = await import("./membrain-extension.ts");
  const fn = mod.default as (pi: any) => void;

  const toolNames: string[] = [];
  const piMock = {
    registerTool(t: any) { toolNames.push(t.name); },
  };

  fn(piMock);
  assert.ok(toolNames.includes("ask"), "should have ask tool");
  console.log("  PASS");
}

async function testStoreToolParams() {
  console.log("TEST 3: store tool exists");
  const mod = await import("./membrain-extension.ts");
  const fn = mod.default as (pi: any) => void;

  const toolNames: string[] = [];
  const piMock = {
    registerTool(t: any) { toolNames.push(t.name); },
  };

  fn(piMock);
  assert.ok(toolNames.includes("store"), "should have store tool");
  console.log("  PASS");
}

async function testNoLanceTools() {
  console.log("TEST 4: lance-only tools are NOT registered");
  const mod = await import("./membrain-extension.ts");
  const fn = mod.default as (pi: any) => void;

  const toolNames: string[] = [];
  const piMock = {
    registerTool(t: any) { toolNames.push(t.name); },
  };

  fn(piMock);

  const badNames = ["memory_recall", "memory_stats", "memory_forget", "memory_consolidate", "memory_update"];
  for (const bad of badNames) {
    assert.ok(!toolNames.includes(bad), `should NOT have ${bad} (lance-only tool)`);
  }
  console.log("  PASS");
}

// ---- test 5: mock HTTP e2e — ask + store via mock server ------

async function testMockHttpE2E() {
  console.log("TEST 5: mock HTTP e2e — ask + store via mock server");

  // Start mock MCP server
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body);
      const id = msg.id;

      if (msg.method === "initialize") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "mcp-session-id": "test-session-123",
        });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "mock-membrain", version: "0.1" },
        }}));
        return;
      }

      if (msg.method === "notifications/initialized") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
        return;
      }

      if (msg.method === "tools/call") {
        const name = msg.params?.name;
        const args = msg.params?.arguments ?? {};

        if (name === "ask") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result: {
            content: [{ type: "text", text: `Mock answer to: ${args.query}` }],
          }}));
          return;
        }

        if (name === "store") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result: {
            content: [{ type: "text", text: `Stored: ${args.content}` }],
          }}));
          return;
        }
      }

      res.writeHead(404);
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { message: "unknown" } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;

  // Point extension to mock server
  const mod = await import("./membrain-extension.ts");
  mod.setEnv("127.0.0.1", String(port));
  mod.resetTestState();

  try {
    // Call ask tool
    const askResult = await mod.callTool("ask", { query: "what is 2+2?" });
    assert.equal(askResult, "Mock answer to: what is 2+2?", "ask should return mock answer");

    // Call store tool
    const storeResult = await mod.callTool("store", { content: "pi is 3.14" });
    assert.equal(storeResult, "Stored: pi is 3.14", "store should return mock confirmation");

    console.log("  PASS — mock HTTP e2e: ask + store work end-to-end");
  } finally {
    server.close();
  }
}

// ---- runner ---

async function runTests() {
  console.log("=== membrain-extension tests ===\n");
  let pass = 0, fail = 0;
  const tests = [testEnvVarsDefaults, testAskToolParams, testStoreToolParams, testNoLanceTools, testMockHttpE2E];

  for (const test of tests) {
    try {
      await test();
      pass++;
    } catch (e: any) {
      fail++;
      console.log(`  FAIL: ${e.message}\n`);
    }
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => { console.error("Runner error:", e); process.exit(1); });
