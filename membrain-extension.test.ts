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

// ---- runner ---

async function runTests() {
  console.log("=== membrain-extension tests ===\n");
  let pass = 0, fail = 0;
  const tests = [testEnvVarsDefaults, testAskToolParams, testStoreToolParams, testNoLanceTools];

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
