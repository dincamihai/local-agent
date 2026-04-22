#!/usr/bin/env npx tsx
/**
 * Tests for board-tui MCP client wrappers (spawnBoardTuiClient, listDelegatedTasks, setFrontmatter).
 * Verifies the MCP protocol interaction that the wrappers in pi-bridge-mcp.ts implement.
 * Run:  npx tsx scanner.test.ts
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = import.meta.dirname;
const MOCK_SCRIPT = path.join(__dirname, "mock-board-tui-tests.js");

// ---- helpers ------ ------ ------------- ---- ---- ------------- ---- -------- ----

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(paths: string[]) {
  for (const p of paths) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Create a task card file with the given frontmatter and body.
 */
function writeTaskCard(tasksDir: string, slug: string, frontmatter: Record<string, string>, body: string): void {
  const header = ["---"];
  const sortedKeys = Object.keys(frontmatter).sort();
  for (const key of sortedKeys) {
    header.push(`${key}: ${frontmatter[key]}`);
  }
  header.push("---");
  header.push("");
  header.push(body);
  fs.writeFileSync(path.join(tasksDir, `${slug}.md`), header.join("\n"));
}

// ---- test 1: spawnBoardTuiClient_starts_subprocess ------ -------- -------- --------

async function test_spawnBoardTuiClient_starts_subprocess() {
  console.log("TEST 1: spawnBoardTuiClient starts subprocess");

  const tasksDir = makeTempDir("pi-test-tasks-");
  writeTaskCard(tasksDir, "my-task", { delegation_status: "queued" }, "# My Task\nDo something");

  // Create a temporary node wrapper that acts as board-tui-mcp on PATH
  const mockBinDir = makeTempDir("pi-mock-bin-");
  try {
    // Copy mock to temp dir
    const mockPath = path.join(mockBinDir, "board-tui-mcp");
    fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
    fs.chmodSync(mockPath, 0o755);

    const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "board-tui-mcp",
      env: {
        ...process.env,
        BOARD_TASKS_DIR: tasksDir,
        PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
      },
    });
    await client.connect(transport);
    assert.ok(client, "spawnBoardTuiClient should return a client");

    // Verify the client is connected by listing tools (triggers MCP session handshake)
    const tools = await client.listTools();
    assert.ok(tools.tools.length > 0, "should list tools from board-tui-mcp");
    const toolNames = tools.tools.map((t: any) => t.name);
    assert.ok(toolNames.includes("list_delegated_tasks"), "should expose list_delegated_tasks");
    assert.ok(toolNames.includes("set_frontmatter"), "should expose set_frontmatter");

    await client.close();
    console.log("  PASS — spawnBoardTuiClient starts subprocess and lists tools");
  } finally {
    cleanup([tasksDir, mockBinDir]);
  }
}

// ---- test 2: listDelegatedTasks_returns_tasks ------ -------- ---- ---------- ------- -

async function test_listDelegatedTasks_returns_tasks() {
  console.log("TEST 2: listDelegatedTasks returns tasks");

  const tasksDir = makeTempDir("pi-test-tasks-");
  const mockBinDir = makeTempDir("pi-mock-bin-");

  try {
    writeTaskCard(tasksDir, "review-pr-123", { delegation_status: "queued", column: "To Do" }, "# Review PR #123\nReview auth changes");
    writeTaskCard(tasksDir, "fix-bug-456", { delegation_status: "done", column: "Done" }, "# Fix Bug #456\nNull pointer fix");
    writeTaskCard(tasksDir, "new-feature", { delegation_status: "queued", column: "Backlog" }, "# New Feature\nAdd dark mode");
    writeTaskCard(tasksDir, "in-progress", { delegation_status: "processing", column: "In Progress" }, "# In Progress\nWIP item");

    // Helper: connect to mock board-tui-mcp and call a tool
    async function callMockTool(toolName: string, args: Record<string, unknown>) {
      const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
      const mockPath = path.join(mockBinDir, "board-tui-mcp");
      fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
      fs.chmodSync(mockPath, 0o755);

      const transport = new StdioClientTransport({
        command: "board-tui-mcp",
        env: {
          ...process.env,
          PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
          BOARD_TASKS_DIR: tasksDir,
        },
      });
      await client.connect(transport);
      try {
        const result = await client.callTool({ name: toolName, arguments: args });
        return result;
      } finally {
        await client.close();
      }
    }

    // Test: list_delegated_tasks with status=queued
    const listResult = await callMockTool("list_delegated_tasks", { status: "queued" });
    const taskText = listResult.content?.[0]?.type === "text" ? listResult.content[0].text : "[]";
    const queued: Array<{ slug: string }> = JSON.parse(taskText);
    assert.ok(Array.isArray(queued), "should return an array");
    assert.equal(queued.length, 2, "should find exactly 2 queued tasks");
    assert.ok(queued.some((t) => t.slug === "review-pr-123"), "should include review-pr-123");
    assert.ok(queued.some((t) => t.slug === "new-feature"), "should include new-feature");
    assert.ok(!queued.some((t) => t.slug === "fix-bug-456"), "should not include done task");
    assert.ok(!queued.some((t) => t.slug === "in-progress"), "should not include processing task");

    // Test: list_delegated_tasks with status=done
    const doneResult = await callMockTool("list_delegated_tasks", { status: "done" });
    const doneText = doneResult.content?.[0]?.type === "text" ? doneResult.content[0].text : "[]";
    const done: Array<{ slug: string }> = JSON.parse(doneText);
    assert.equal(done.length, 1, "should find exactly 1 done task");
    assert.equal(done[0].slug, "fix-bug-456", "should return fix-bug-456");

    console.log("  PASS — listDelegatedTasks returns correctly filtered tasks");
  } finally {
    cleanup([tasksDir, mockBinDir]);
  }
}

// ---- test 3: setFrontmatter_updates_card ------ -------- -------- ------------ -- --------

async function test_setFrontmatter_updates_card() {
  console.log("TEST 3: setFrontmatter updates card");

  const tasksDir = makeTempDir("pi-test-frontmatter-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const taskSlug = "my-card";
  const body = "# My Card Review\nSome important details here";
  writeTaskCard(tasksDir, taskSlug, { delegation_status: "queued", column: "Backlog" }, body);

  try {
    // Read the initial content to verify later
    const initialContent = fs.readFileSync(path.join(tasksDir, `${taskSlug}.md`), "utf-8");
    assert.ok(initialContent.includes("delegation_status: queued"), "initial status should be queued");

    // Helper: connect to mock board-tui-mcp and call set_frontmatter
    async function callSetFrontmatter(slug: string, key: string, value: string): Promise<void> {
      const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
      const mockPath = path.join(mockBinDir, "board-tui-mcp");
      fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
      fs.chmodSync(mockPath, 0o755);

      const transport = new StdioClientTransport({
        command: "board-tui-mcp",
        env: {
          ...process.env,
          PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
          BOARD_TASKS_DIR: tasksDir,
        },
      });
      await client.connect(transport);
      try {
        await client.callTool({
          name: "set_frontmatter",
          arguments: { slug, key, value },
        });
      } finally {
        await client.close();
      }
    }

    // Call set_frontmatter via MCP
    await callSetFrontmatter(taskSlug, "delegation_status", "processing");

    // Verify the file was updated
    const updatedContent = fs.readFileSync(path.join(tasksDir, `${taskSlug}.md`), "utf-8");
    assert.ok(updatedContent.includes("delegation_status: processing"), "should update delegation_status to processing");
    assert.ok(updatedContent.includes("---"), "should preserve YAML delimiters");
    assert.ok(updatedContent.includes("column: Backlog"), "should preserve column field");
    assert.ok(updatedContent.includes(body), "should preserve body content");

    console.log("  PASS — setFrontmatter updates card frontmatter on disk");
  } finally {
    cleanup([tasksDir, mockBinDir]);
  }
}

// ---- test 4: client_closes_cleanly ------ -------- ------ -------- ---------- --------

async function test_client_closes_cleanly() {
  console.log("TEST 4: client closes cleanly");

  const tasksDir = makeTempDir("pi-test-cleanup-");
  writeTaskCard(tasksDir, "close-test", { delegation_status: "queued" }, "# Close Test");

  // Helper: create mock bin with wrapper script
  function createMockWithWrapper(): string {
    const mockBinDir = makeTempDir("pi-mock-bin-");
    const mockPath = path.join(mockBinDir, "board-tui-mcp");
    fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
    fs.chmodSync(mockPath, 0o755);
    return mockBinDir;
  }

  // Test 1: Explicit close after client creation
  {
    const mockBinDir = createMockWithWrapper();
    const env = {
      ...process.env,
      PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
      BOARD_TASKS_DIR: tasksDir,
    };
    try {
      const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
      const transport = new StdioClientTransport({ command: "board-tui-mcp", env });
      await client.connect(transport);
      assert.ok(client, "should have a connected client");
      await client.close();

      // Verify client is closed by attempting a call (should throw)
      let closed = false;
      try {
        await client.callTool({
          name: "list_delegated_tasks",
          arguments: { status: "queued" },
        });
      } catch {
        closed = true;
      }
      assert.ok(closed, "should throw after client is closed");
    } finally {
      cleanup([mockBinDir]);
    }
  }

  // Test 2: Implicit close via list tool call (auto-close in finally)
  {
    const mockBinDir = createMockWithWrapper();
    const env = {
      ...process.env,
      PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
      BOARD_TASKS_DIR: tasksDir,
    };
    const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: "board-tui-mcp", env });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "list_delegated_tasks",
        arguments: { status: "queued" },
      });
      const taskText = result.content?.[0]?.type === "text" ? result.content[0].text : "[]";
      const tasks: Array<{ slug: string }> = JSON.parse(taskText);
      assert.equal(tasks.length, 1, "should return 1 task");
      assert.equal(tasks[0].slug, "close-test", "should return close-test");
    } finally {
      await client.close();
    }
    cleanup([mockBinDir]);
  }

  // Test 3: Multiple sequential close cycles
  for (let i = 0; i < 3; i++) {
    const mockBinDir = createMockWithWrapper();
    const env = {
      ...process.env,
      PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
      BOARD_TASKS_DIR: tasksDir,
    };
    try {
      const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
      const transport = new StdioClientTransport({ command: "board-tui-mcp", env });
      await client.connect(transport);
      await client.close();
    } finally {
      cleanup([mockBinDir]);
    }
  }

  // Give any spawned processes time to exit
  await new Promise<void>((r) => setTimeout(r, 500));

  console.log("  PASS — client closes cleanly, no resource leaks");

  cleanup([tasksDir]);
}

// ---- test 5: syncTaskCard updates frontmatter and appends result ------ -------- -------

async function test_syncTaskCard_updates_frontmatter_and_body() {
  console.log("TEST 5: syncTaskCard updates frontmatter and appends result to body");

  const tasksDir = makeTempDir("pi-test-sync-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const taskSlug = "sync-card";
  writeTaskCard(tasksDir, taskSlug, { delegation_status: "processing", column: "Backlog" }, "# Sync Card\nDo work");

  try {
    // Helper: create mock MCP client
    async function callTool(name: string, args: Record<string, unknown>) {
      const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
      const mockPath = path.join(mockBinDir, "board-tui-mcp");
      fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
      fs.chmodSync(mockPath, 0o755);

      const transport = new StdioClientTransport({
        command: "board-tui-mcp",
        env: {
          ...process.env,
          PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
          BOARD_TASKS_DIR: tasksDir,
        },
      });
      await client.connect(transport);
      try {
        const result = await client.callTool({ name, arguments: args });
        return result;
      } finally {
        await client.close();
      }
    }

    // Step 1: set_frontmatter to done
    await callTool("set_frontmatter", { slug: taskSlug, key: "delegation_status", value: "done" });
    let content = fs.readFileSync(path.join(tasksDir, `${taskSlug}.md`), "utf-8");
    assert.ok(content.includes("delegation_status: done"), "frontmatter should be updated to done");

    // Step 2: get_task to read body
    const getResult = await callTool("get_task", { slug: taskSlug });
    const taskData = getResult.content?.[0]?.type === "text" ? JSON.parse(getResult.content[0].text) : null;
    const body: string = taskData?.body ?? "";
    assert.ok(body.includes("# Sync Card"), "body should contain original content");

    // Step 3: update_task with result appended
    const newBody = body + "\n\n## Result\n\n**DONE** @ 2026-04-22T00:00:00.000Z\n\nTask completed successfully\n";
    await callTool("update_task", { slug: taskSlug, body: newBody });

    // Verify final file
    content = fs.readFileSync(path.join(tasksDir, `${taskSlug}.md`), "utf-8");
    assert.ok(content.includes("delegation_status: done"), "frontmatter should still be done");
    assert.ok(content.includes("## Result"), "body should have Result section");
    assert.ok(content.includes("Task completed successfully"), "body should have result text");

    console.log("  PASS — syncTaskCard updates frontmatter and appends result");
  } finally {
    cleanup([tasksDir, mockBinDir]);
  }
}

// ---- test 6: syncTaskCard appends to existing Result section ------ -------- --------

async function test_syncTaskCard_appends_to_existing_result() {
  console.log("TEST 6: syncTaskCard appends to existing Result section");

  const tasksDir = makeTempDir("pi-test-sync2-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const taskSlug = "sync-card2";
  writeTaskCard(tasksDir, taskSlug, { delegation_status: "processing", column: "Backlog" }, "# Sync Card 2\nDo work\n\n## Result\n\nInitial result\n");

  try {
    async function callTool(name: string, args: Record<string, unknown>) {
      const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
      const mockPath = path.join(mockBinDir, "board-tui-mcp");
      fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
      fs.chmodSync(mockPath, 0o755);

      const transport = new StdioClientTransport({
        command: "board-tui-mcp",
        env: {
          ...process.env,
          PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
          BOARD_TASKS_DIR: tasksDir,
        },
      });
      await client.connect(transport);
      try {
        return await client.callTool({ name, arguments: args });
      } finally {
        await client.close();
      }
    }

    const getResult = await callTool("get_task", { slug: taskSlug });
    const taskData = getResult.content?.[0]?.type === "text" ? JSON.parse(getResult.content[0].text) : null;
    const body: string = taskData?.body ?? "";

    const newBody = body + "\n**FAILED** @ 2026-04-22T00:00:00.000Z\n\nError occurred\n";
    await callTool("update_task", { slug: taskSlug, body: newBody });

    const content = fs.readFileSync(path.join(tasksDir, `${taskSlug}.md`), "utf-8");
    assert.ok(content.includes("Initial result"), "should preserve existing result");
    assert.ok(content.includes("Error occurred"), "should append new result");

    console.log("  PASS — syncTaskCard appends to existing Result section");
  } finally {
    cleanup([tasksDir, mockBinDir]);
  }
}

// ---- test 7: scanner cancelled handling clears frontmatter ------ -------- -------

async function test_scanner_cancelled_clears_frontmatter() {
  console.log("TEST 7: scanner cancelled handling clears frontmatter");

  const tasksDir = makeTempDir("pi-test-cancel-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  writeTaskCard(tasksDir, "cancel-me", { delegation_status: "cancelled", column: "Backlog" }, "# Cancel Me\nBody");
  writeTaskCard(tasksDir, "keep-me", { delegation_status: "queued", column: "Backlog" }, "# Keep Me\nBody");

  try {
    const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
    const mockPath = path.join(mockBinDir, "board-tui-mcp");
    fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
    fs.chmodSync(mockPath, 0o755);

    const transport = new StdioClientTransport({
      command: "board-tui-mcp",
      env: {
        ...process.env,
        PATH: mockBinDir + path.delimiter + (process.env.PATH ?? ""),
        BOARD_TASKS_DIR: tasksDir,
      },
    });
    await client.connect(transport);
    try {
      // list_delegated_tasks("cancelled") should return cancel-me
      const result = await client.callTool({
        name: "list_delegated_tasks",
        arguments: { status: "cancelled" },
      });
      const taskText = result.content?.[0]?.type === "text" ? result.content[0].text : "[]";
      const tasks = JSON.parse(taskText);
      assert.equal(tasks.length, 1, "should find 1 cancelled task");
      assert.equal(tasks[0].slug, "cancel-me", "should be cancel-me");

      // Simulate clearing frontmatter
      await client.callTool({
        name: "set_frontmatter",
        arguments: { slug: "cancel-me", key: "delegation_status", value: "" },
      });

      const content = fs.readFileSync(path.join(tasksDir, "cancel-me.md"), "utf-8");
      assert.ok(!content.includes("delegation_status: cancelled"), "should clear cancelled status");
      assert.ok(content.includes("column: Backlog"), "should preserve other frontmatter");
    } finally {
      await client.close();
    }

    console.log("  PASS — scanner cancelled handling clears frontmatter");
  } finally {
    cleanup([tasksDir, mockBinDir]);
  }
}

// ---- Mock PiRpcClient for testing processQueueTask ------ -------- -------

class MockPiRpcClient {
  containerName: string | null = null;
  private _result: string | null = null;
  private _throwAt: string | null = null;
  private _throwError: Error | null = null;

  async start(): Promise<void> {
    this.containerName = "mock-agent";
    if (this._throwAt === "start") throw this._throwError!;
  }
  async ensureReady(): Promise<void> {
    if (this._throwAt === "ensureReady") throw this._throwError!;
  }
  async prompt(): Promise<void> {
    if (this._throwAt === "prompt") throw this._throwError!;
  }
  async waitForIdle(): Promise<void> {
    if (this._throwAt === "waitForIdle") throw this._throwError!;
  }
  getResult(): string | null { return this._result; }
  async stop(): Promise<void> { this.containerName = null; }
  get isRunning(): boolean { return this.containerName !== null; }

  setResult(result: string) { this._result = result; }
  willThrowAt(step: string, err: Error) { this._throwAt = step; this._throwError = err; }
}

// ---- test 8: scanner finds queued task and enqueues it ------ -------- -------

async function test_scanner_finds_queued_task() {
  console.log("TEST 8: scanner finds queued task and enqueues it");
  const mod = await import("./pi-bridge-mcp.ts");
  const { openQueue, queueList } = await import("./queue.js");

  const tasksDir = makeTempDir("pi-test-scan-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const dbDir = makeTempDir("pi-test-db-");
  const dbPath = path.join(dbDir, "queue.db");
  const queueDb = openQueue(dbPath);

  writeTaskCard(tasksDir, "delegate-me", { delegation_status: "queued", column: "Backlog" }, "# Delegate Me\nDo work");

  const mockPath = path.join(mockBinDir, "board-tui-mcp");
  fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
  fs.chmodSync(mockPath, 0o755);

  const oldPath = process.env.PATH;
  const oldBoardDir = process.env.BOARD_TASKS_DIR;
  process.env.PATH = mockBinDir + path.delimiter + (oldPath ?? "");
  process.env.BOARD_TASKS_DIR = tasksDir;

  try {
    await mod.scanReposForDelegation(queueDb, tasksDir);

    const tasks = queueList(queueDb);
    assert.equal(tasks.length, 1, "should enqueue 1 task");
    assert.equal(tasks[0].taskSlug, "delegate-me", "task slug should match");
    assert.equal(tasks[0].status, "queued", "status should be queued");

    const content = fs.readFileSync(path.join(tasksDir, "delegate-me.md"), "utf-8");
    assert.ok(content.includes("delegation_status: processing"), "card should be updated to processing");

    console.log("  PASS — scanner finds queued task and enqueues it");
  } finally {
    process.env.PATH = oldPath;
    process.env.BOARD_TASKS_DIR = oldBoardDir;
    cleanup([tasksDir, mockBinDir, dbDir]);
  }
}

// ---- test 9: scanner skips already-enqueued task ------ -------- -------

async function test_scanner_skips_already_enqueued() {
  console.log("TEST 9: scanner skips already-enqueued task");
  const mod = await import("./pi-bridge-mcp.ts");
  const { openQueue, queueList, queueAdd } = await import("./queue.js");

  const tasksDir = makeTempDir("pi-test-scan-dup-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const dbDir = makeTempDir("pi-test-db-");
  const dbPath = path.join(dbDir, "queue.db");
  const queueDb = openQueue(dbPath);

  writeTaskCard(tasksDir, "dup-task", { delegation_status: "queued", column: "Backlog" }, "# Dup Task\nDo work");
  queueAdd(queueDb, { prompt: "existing", taskSlug: "dup-task" });

  const mockPath = path.join(mockBinDir, "board-tui-mcp");
  fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
  fs.chmodSync(mockPath, 0o755);

  const oldPath = process.env.PATH;
  const oldBoardDir = process.env.BOARD_TASKS_DIR;
  process.env.PATH = mockBinDir + path.delimiter + (oldPath ?? "");
  process.env.BOARD_TASKS_DIR = tasksDir;

  try {
    await mod.scanReposForDelegation(queueDb, tasksDir);

    const tasks = queueList(queueDb);
    assert.equal(tasks.length, 1, "should not add duplicate");
    assert.equal(tasks[0].taskSlug, "dup-task", "existing task preserved");

    console.log("  PASS — scanner skips already-enqueued task");
  } finally {
    process.env.PATH = oldPath;
    process.env.BOARD_TASKS_DIR = oldBoardDir;
    cleanup([tasksDir, mockBinDir, dbDir]);
  }
}

// ---- test 10: scanner skips done tasks ------ -------- -------

async function test_scanner_skips_done_tasks() {
  console.log("TEST 10: scanner skips done tasks");
  const mod = await import("./pi-bridge-mcp.ts");
  const { openQueue, queueList } = await import("./queue.js");

  const tasksDir = makeTempDir("pi-test-scan-done-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const dbDir = makeTempDir("pi-test-db-");
  const dbPath = path.join(dbDir, "queue.db");
  const queueDb = openQueue(dbPath);

  writeTaskCard(tasksDir, "done-task", { delegation_status: "done", column: "Done" }, "# Done Task\nComplete");

  const mockPath = path.join(mockBinDir, "board-tui-mcp");
  fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
  fs.chmodSync(mockPath, 0o755);

  const oldPath = process.env.PATH;
  const oldBoardDir = process.env.BOARD_TASKS_DIR;
  process.env.PATH = mockBinDir + path.delimiter + (oldPath ?? "");
  process.env.BOARD_TASKS_DIR = tasksDir;

  try {
    await mod.scanReposForDelegation(queueDb, tasksDir);

    const tasks = queueList(queueDb);
    assert.equal(tasks.length, 0, "should not enqueue done tasks");

    console.log("  PASS — scanner skips done tasks");
  } finally {
    process.env.PATH = oldPath;
    process.env.BOARD_TASKS_DIR = oldBoardDir;
    cleanup([tasksDir, mockBinDir, dbDir]);
  }
}

// ---- test 11: processQueueTask success updates queue and card ------ --------

async function test_processQueueTask_success() {
  console.log("TEST 11: processQueueTask success updates queue and card");
  const mod = await import("./pi-bridge-mcp.ts");
  const { openQueue, queueAdd, queueGet } = await import("./queue.js");

  const tasksDir = makeTempDir("pi-test-pq-success-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const dbDir = makeTempDir("pi-test-db-");
  const dbPath = path.join(dbDir, "queue.db");
  const queueDb = openQueue(dbPath);

  writeTaskCard(tasksDir, "success-task", { delegation_status: "processing", column: "In Progress" }, "# Success Task\nDo work");
  const task = queueAdd(queueDb, { prompt: "do work", taskSlug: "success-task" });

  const mockPath = path.join(mockBinDir, "board-tui-mcp");
  fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
  fs.chmodSync(mockPath, 0o755);

  const oldPath = process.env.PATH;
  const oldBoardDir = process.env.BOARD_TASKS_DIR;
  process.env.PATH = mockBinDir + path.delimiter + (oldPath ?? "");
  process.env.BOARD_TASKS_DIR = tasksDir;

  try {
    const mockClient = new MockPiRpcClient();
    mockClient.setResult("Agent completed the work");
    await mod.processQueueTask(task, mockClient, queueDb, tasksDir);

    const updated = queueGet(queueDb, task.id);
    assert.equal(updated?.status, "done", "queue status should be done");
    assert.equal(updated?.result, "Agent completed the work", "result should match");

    const content = fs.readFileSync(path.join(tasksDir, "success-task.md"), "utf-8");
    assert.ok(content.includes("delegation_status: done"), "card frontmatter should be done");
    assert.ok(content.includes("Agent completed the work"), "card body should have result");

    console.log("  PASS — processQueueTask success updates queue and card");
  } finally {
    process.env.PATH = oldPath;
    process.env.BOARD_TASKS_DIR = oldBoardDir;
    cleanup([tasksDir, mockBinDir, dbDir]);
  }
}

// ---- test 12: processQueueTask failure updates queue and card ------ --------

async function test_processQueueTask_failure() {
  console.log("TEST 12: processQueueTask failure updates queue and card");
  const mod = await import("./pi-bridge-mcp.ts");
  const { openQueue, queueAdd, queueGet } = await import("./queue.js");

  const tasksDir = makeTempDir("pi-test-pq-fail-");
  const mockBinDir = makeTempDir("pi-mock-bin-");
  const dbDir = makeTempDir("pi-test-db-");
  const dbPath = path.join(dbDir, "queue.db");
  const queueDb = openQueue(dbPath);

  writeTaskCard(tasksDir, "fail-task", { delegation_status: "processing", column: "In Progress" }, "# Fail Task\nDo work");
  const task = queueAdd(queueDb, { prompt: "do work", taskSlug: "fail-task" });

  const mockPath = path.join(mockBinDir, "board-tui-mcp");
  fs.writeFileSync(mockPath, `#!/bin/sh\nexec node "${MOCK_SCRIPT}" "$@"\n`);
  fs.chmodSync(mockPath, 0o755);

  const oldPath = process.env.PATH;
  const oldBoardDir = process.env.BOARD_TASKS_DIR;
  process.env.PATH = mockBinDir + path.delimiter + (oldPath ?? "");
  process.env.BOARD_TASKS_DIR = tasksDir;

  try {
    const mockClient = new MockPiRpcClient();
    mockClient.willThrowAt("waitForIdle", new Error("Agent crashed"));
    await mod.processQueueTask(task, mockClient, queueDb, tasksDir);

    const updated = queueGet(queueDb, task.id);
    assert.equal(updated?.status, "failed", "queue status should be failed");
    assert.ok(updated?.error?.includes("Agent crashed"), "error should be recorded");

    const content = fs.readFileSync(path.join(tasksDir, "fail-task.md"), "utf-8");
    assert.ok(content.includes("delegation_status: failed"), "card frontmatter should be failed");
    assert.ok(content.includes("Agent crashed"), "card body should have error");

    console.log("  PASS — processQueueTask failure updates queue and card");
  } finally {
    process.env.PATH = oldPath;
    process.env.BOARD_TASKS_DIR = oldBoardDir;
    cleanup([tasksDir, mockBinDir, dbDir]);
  }
}

// ---- runner ------ ------ ------ ------ -------- ------- ------ --------- -------- ------- --

async function runTests() {
  console.log("=== board-tui MCP client wrapper tests ===\n");
  let pass = 0;
  let fail = 0;

  const tests: Array<() => Promise<void>> = [
    test_spawnBoardTuiClient_starts_subprocess,
    test_listDelegatedTasks_returns_tasks,
    test_setFrontmatter_updates_card,
    test_client_closes_cleanly,
    test_syncTaskCard_updates_frontmatter_and_body,
    test_syncTaskCard_appends_to_existing_result,
    test_scanner_cancelled_clears_frontmatter,
    test_scanner_finds_queued_task,
    test_scanner_skips_already_enqueued,
    test_scanner_skips_done_tasks,
    test_processQueueTask_success,
    test_processQueueTask_failure,
  ];

  for (const test of tests) {
    try {
      await test();
      pass++;
      console.log("");
    } catch (e: any) {
      fail++;
      console.log(`  FAIL: ${e.message}\n${e.stack}\n`);
    }
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
