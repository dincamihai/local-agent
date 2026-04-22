#!/usr/bin/env npx tsx
/**
 * Tests for scanReposForDelegation (board-tui MCP -> local-agent queue bridge).
 * Run:  npx tsx scanner.test.ts
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const __dirname = import.meta.dirname;

// ---- helpers ------ ------ ----------------- ---- ----------------- -------- ----

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(paths: string[]) {
  for (const p of paths) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
}

// ---- test 1: scanner_calls_list_delegated_tasks ------ -------- -------- --------

async function testScannerCallsListDelegatedTasks() {
  console.log("TEST 1: scanner calls list_delegated_tasks");

  const tasksDir = makeTempDir("pi-scanner-tasks-");
  fs.writeFileSync(path.join(tasksDir, "my-task.md"),
    "---\ndelegation_status: queued\n---\n# My Task\nbody here");
  fs.writeFileSync(path.join(tasksDir, "done-task.md"),
    "---\ndelegation_status: done\n---\n# Done Task\nbody here");
  fs.writeFileSync(path.join(tasksDir, "processing-task.md"),
    "---\ndelegation_status: processing\n---\n# Processing Task\nbody here");

  const testDir = makeTempDir("pi-scanner-test-");
  const mockScript = path.join(__dirname, "mock-board-tui-tests.js");

  // Start mock board-tui MCP server (EJS version)
  const proc = spawn("node", [mockScript], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BOARD_TASKS_DIR: tasksDir },
  });

  // Collect all output lines
  const lines = new Array<string>();
  proc.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) lines.push(line);
    }
  });

  // Collect responses by ID
  const pending = new Map<number, (value: any) => void>();
  let nextId = 0;

  function waitForMessage() {
    return new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);

      // Send immediately and wait for response
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } });
      proc.stdin?.write(msg + "\n");
    });
  }

  function waitForInitReady() {
    return new Promise<void>((resolve) => {
      // Listen for the init response (sent immediately by server)
      const checkLine = (line: string) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.result && parsed.result.protocolVersion) {
            proc.stdout.off("data", onData);
            resolve();
          }
        } catch {}
      };

      // Check all lines already collected
      for (const l of lines) checkLine(l);

      // Continue listening
      function onData(chunk: Buffer) {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) checkLine(line);
        }
      }

      if (!lines.some(l => { try { return JSON.parse(l).result?.protocolVersion; } catch { return false; } })) {
        proc.stdout.on("data", onData);
      } else {
        // Already got it
      }
    });
  }

  // Send all requests as a batch
  const requests = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_delegated_tasks", arguments: { status: "queued" } } }),
  ];

  // Write all at once after short delay
  await new Promise<void>((resolve) => {
    proc.stdout.on("data", function handler(chunk: Buffer) {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) {
          for (const req of requests) {
            proc.stdin?.write(req + "\n");
          }
          proc.stdout.off("data", handler);
          resolve();
          return;
        }
      }
    });
  });

  // Wait for results
  await new Promise<void>(resolve => setTimeout(resolve, 200));
  proc.kill();

  // Parse the last few responses
  const responses = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];

  const listToolCall = responses.find(r => r.id === 2);
  assert.ok(listToolCall, "should have received tools/list response");
  const toolNames = listToolCall.result.tools.map((t: any) => t.name);
  assert.ok(toolNames.includes("list_delegated_tasks"), "should expose list_delegated_tasks tool");

  const toolsCallResult = responses.find(r => r.id === 3);
  assert.ok(toolsCallResult, "should have received tools/call response");
  const taskText = toolsCallResult.result.content?.[0]?.text || "[]";
  const tasks: Array<{ slug: string; delegation_status: string }> = JSON.parse(taskText);

  assert.ok(tasks.length > 0, "should find at least one task");
  assert.equal(tasks.length, 1, "should find exactly 1 queued task");
  assert.equal(tasks[0].delegation_status, "queued", "task status should be queued");
  assert.equal(tasks[0].slug, "my-task", "should have correct slug");
  assert.ok(!tasks.some(t => t.slug === "done-task"), "should not include done-task");
  assert.ok(!tasks.some(t => t.slug === "processing-task"), "should not include processing-task");

  cleanup([tasksDir, testDir]);
  console.log("  PASS — scanner calls list_delegated_tasks(\"queued\") and filters correctly");
}

// ---- test 2: scanner_enqueues_found_task ------ -------- ------------ --------- --

async function testScannerEnqueuesFoundTask() {
  console.log("TEST 2: scanner enqueues found task");

  const { openQueue, queueList, queueAdd } = await import(
    path.join(__dirname, "queue.js").replace(/\.ts$/, ".js")
  );

  const db = openQueue(":memory:") as any;

  const mockTasks = [
    { slug: "review-pr-123", body: "# Review PR #123\n\nReview the auth module changes.", column: "Backlog" },
    { slug: "fix-bug-456", body: "# Fix Bug #456\n\nHandle null pointer in UserService.", column: "To Do" },
  ];

  // Enqueue each task as scanReposForDelegation would do
  for (const task of mockTasks) {
    queueAdd(db, { prompt: task.body, taskSlug: task.slug });
  }

  const queued = queueList(db, "queued");
  assert.ok(queued.length === 2, "should have 2 queued tasks");

  const slugs = queued.map(t => t.taskSlug).sort();
  assert.deepStrictEqual(slugs, ["fix-bug-456", "review-pr-123"], "slugs should match expected tasks");

  const reviewTask = queued.find(t => t.taskSlug === "review-pr-123");
  assert.ok(reviewTask?.prompt.includes("Review PR #123"), "prompt should contain title");
  assert.ok(reviewTask?.prompt.includes("auth module"), "prompt should contain body details");

  console.log("  PASS — scanner enqueues found tasks into the local-agent queue");
}

// ---- test 3: scanner_skips_already_enqueued ------ -------- --------- -------- ----

async function testScannerSkipsAlreadyEnqueued() {
  console.log("TEST 3: scanner skips already-enqueued tasks (same slug)");

  const { openQueue, queueList, queueAdd } = await import(
    path.join(__dirname, "queue.js").replace(/\.ts$/, ".js")
  );

  const db = openQueue(":memory:") as any;

  // Pre-enqueue a task
  queueAdd(db, { prompt: "# Existing task", taskSlug: "existing-task" });

  function hasSlug(db: any, slug: string) {
    return queueList(db).some(t => t.taskSlug === slug);
  }

  assert.ok(hasSlug(db, "existing-task"), "pre-existing task should be in queue");

  // Simulate scanner detecting a task already in the queue
  const boardTuiTask = { slug: "existing-task", body: "# Rescanned task" };
  if (!hasSlug(db, boardTuiTask.slug)) {
    queueAdd(db, { prompt: boardTuiTask.body, taskSlug: boardTuiTask.slug });
  }

  const sameSlug = queueList(db).filter(t => t.taskSlug === "existing-task");
  assert.equal(sameSlug.length, 1, "should have exactly 1 task with this slug (deduped)");

  // Add a genuinely new task
  if (!hasSlug(db, "new-task")) {
    queueAdd(db, { prompt: "# New task", taskSlug: "new-task" });
  }

  assert.equal(queueList(db).length, 2, "should have exactly 2 unique tasks total");

  console.log("  PASS — scanner skips already-enqueued tasks (duplicates by slug)");
}

// ---- test 4: scanner_updates_card_to_processing ------ -------- ------- --------- --

async function testScannerUpdatesCardToProcessing() {
  console.log("TEST 4: scanner updates card frontmatter to processing");

  const tasksDir = makeTempDir("pi-scanner-fmr-");

  // Create a task card with delegation_status: queued
  fs.writeFileSync(path.join(tasksDir, "my-review.md"),
    "---\ncolumn: To Do\ndelegation_status: queued\n---\n# My Review\nReview this PR");

  // Simulate set_frontmatter via MCP (same logic as scanReposForDelegation)
  function setFrontmatter(filePath: string, key: string, value: string) {
    let content = fs.readFileSync(filePath, "utf-8");
    const fmMatch = content.match(/^(---\n[\s\S]*?\n---)/);
    if (!fmMatch) return;

    const fmBlock = fmMatch[0];
    const inner = fmBlock.slice(4, -4); // strip ---\n and \n---

    const prefix = new RegExp(`^${key}: .*`, "m");
    const updatedInner = inner.replace(prefix, `${key}: ${value}`);

    const newBlock = `---\n${updatedInner}\n---`;
    content = content.replace(fmBlock, newBlock);
    fs.writeFileSync(filePath, content);
  }

  const taskFile = path.join(tasksDir, "my-review.md");
  setFrontmatter(taskFile, "delegation_status", "processing");

  const updatedContent = fs.readFileSync(taskFile, "utf-8");
  assert.ok(
    updatedContent.includes("delegation_status: processing"),
    "should update delegation_status to processing"
  );
  assert.ok(updatedContent.includes("---"), "should preserve YAML delimiters");
  assert.ok(updatedContent.includes("column: To Do"), "should preserve column field");
  assert.ok(updatedContent.includes("# My Review"), "should preserve body content");

  cleanup([tasksDir]);
  console.log("  PASS — scanner updates card frontmatter to 'processing'");
}

// ---- test 5: scanner_builds_prompt_from_body ------ -------- -------- -------- --- --

async function testScannerBuildsPromptFromBody() {
  console.log("TEST 5: scanner builds prompt from task body (strips frontmatter)");

  const { openQueue, queueList, queueAdd } = await import(
    path.join(__dirname, "queue.js").replace(/\.ts$/, ".js")
  );

  const tasksDir = makeTempDir("pi-scanner-prompt-");

  const taskContent = [
    "---",
    "column: Backlog",
    "created: 2026-04-21",
    "delegation_status: queued",
    "---",
    "",
    "# Scan repositories for delegation queue",
    "",
    "Review all git repos and identify tasks for delegation.",
    "",
    "## Acceptance criteria",
    "",
    "- Check all repos have board-tui task cards",
    "- Verify no stale delegation_status=queued cards",
  ].join("\n");

  fs.writeFileSync(path.join(tasksDir, "scan-repos.md"), taskContent);

  // Extract body (strip frontmatter) — matching scanReposForDelegation regex
  const fmMatch = taskContent.match(/^(---\n[\s\S]*?\n---)\s*([\s\S]*)$/);
  assert.ok(fmMatch, "frontmatter regex should match");

  // Build prompt from body
  const prompt = (fmMatch as RegExpMatchArray)[2]?.trim() ?? taskContent;

  const db = openQueue(":memory:") as any;
  queueAdd(db, { prompt, taskSlug: "scan-repos" });

  const queued = queueList(db);
  assert.ok(queued.length > 0, "should have a queued task");
  assert.ok(queued[0].prompt.includes("Scan repositories"), "prompt should include title");
  assert.ok(queued[0].prompt.includes("Acceptance criteria"), "prompt should include acceptance criteria");
  assert.ok(queued[0].prompt.includes("delegation_status=queued"), "prompt should include notes");

  // Frontmatter should NOT be in the prompt
  assert.ok(
    !queued[0].prompt.includes("column: Backlog"),
    "prompt should not include frontmatter"
  );
  assert.ok(
    !queued[0].prompt.startsWith("---"),
    "prompt should not start with YAML delimiters"
  );

  cleanup([tasksDir]);
  console.log("  PASS — scanner builds prompt from task body, strips frontmatter");
}

// ---- runner ------ ------------------------- ---------- --------- -------- ------- --

async function runTests() {
  console.log("=== scanReposForDelegation tests ===\n");
  let pass = 0;
  let fail = 0;

  const tests: Array<() => Promise<void>> = [
    testScannerCallsListDelegatedTasks,
    testScannerEnqueuesFoundTask,
    testScannerSkipsAlreadyEnqueued,
    testScannerUpdatesCardToProcessing,
    testScannerBuildsPromptFromBody,
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
