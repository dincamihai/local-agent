#!/usr/bin/env npx tsx
/**
 * Smoke tests for the delegation queue (queue.ts).
 * Run:  npx tsx queue.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Database from "better-sqlite3";

import { openQueue, queueAdd, queueClaim, queueComplete, queueFail, queueCancel, queueGet, queueList } from "./queue.js";

let tmpDir: string;
let dbPath: string;
let db: Database.Database;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-queue-test-"));
  dbPath = join(tmpDir, "test-queue.db");
  db = openQueue(dbPath);
}

function teardown() {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

// ---- tests -----------------------------------------------------------------

function testAddAndGet() {
  console.log("TEST 1: queueAdd + queueGet");
  const task = queueAdd(db, { prompt: "hello world", taskSlug: "test-1" });
  assert.ok(task.id, "task should have id");
  assert.equal(task.prompt, "hello world");
  assert.equal(task.taskSlug, "test-1");
  assert.equal(task.status, "queued");
  assert.ok(task.queuedAt > 0);

  const fetched = queueGet(db, task.id);
  assert.deepEqual(fetched, task, "get should return same task");
  console.log("  PASS");
}

function testAddWithOptionalFields() {
  console.log("TEST 2: queueAdd with workspace and taskFile");
  const task = queueAdd(db, {
    prompt: "do stuff",
    taskSlug: "test-2",
    workspace: "/tmp/repo",
    taskFile: "/tmp/repo/.tasks/test-2.md",
  });
  assert.equal(task.workspace, "/tmp/repo");
  assert.equal(task.taskFile, "/tmp/repo/.tasks/test-2.md");
  console.log("  PASS");
}

function testGetMissing() {
  console.log("TEST 3: queueGet returns null for unknown id");
  const result = queueGet(db, "nonexistent-id");
  assert.equal(result, null);
  console.log("  PASS");
}

async function testClaim() {
  console.log("TEST 4: queueClaim picks oldest queued task");
  const task1 = queueAdd(db, { prompt: "first", taskSlug: "a" });
  await sleep(2); // ensure different queued_at for deterministic FIFO
  const task2 = queueAdd(db, { prompt: "second", taskSlug: "b" });

  const claimed = queueClaim(db, "worker-1");
  assert.ok(claimed, "should claim a task");
  assert.equal(claimed.id, task1.id, "should claim oldest (first) task");
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.agentId, "worker-1");
  assert.ok(claimed.startedAt! >= claimed.queuedAt);

  // Second claim picks next
  const claimed2 = queueClaim(db, "worker-2");
  assert.equal(claimed2!.id, task2.id, "should claim second task");

  // No more tasks
  const claimed3 = queueClaim(db, "worker-3");
  assert.equal(claimed3, null, "no more queued tasks");
  console.log("  PASS");
}

function testClaimIsAtomic() {
  console.log("TEST 5: queueClaim is atomic — same task not claimed twice");
  queueAdd(db, { prompt: "race condition test" });

  const claimed1 = queueClaim(db, "worker-a");
  const claimed2 = queueClaim(db, "worker-b");
  assert.ok(claimed1 !== null, "first worker should get the task");
  assert.equal(claimed2, null, "second worker gets nothing — already claimed");
  console.log("  PASS");
}

function testComplete() {
  console.log("TEST 6: queueComplete marks task done with result");
  const task = queueAdd(db, { prompt: "finish me" });
  queueClaim(db, "worker-1");

  queueComplete(db, task.id, "task output here");
  const done = queueGet(db, task.id)!;
  assert.equal(done.status, "done");
  assert.equal(done.result, "task output here");
  assert.ok(done.completedAt! >= done.startedAt!);
  console.log("  PASS");
}

function testFail() {
  console.log("TEST 7: queueFail marks task failed with error, increments retry");
  const task = queueAdd(db, { prompt: "will fail" });
  queueClaim(db, "worker-1");

  queueFail(db, task.id, "something went wrong");
  const failed = queueGet(db, task.id)!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "something went wrong");
  assert.equal(failed.retryCount, 1);
  assert.ok(failed.completedAt! >= failed.startedAt!);

  // Fail again increments retry
  queueFail(db, task.id, "still failing");
  const failed2 = queueGet(db, task.id)!;
  assert.equal(failed2.retryCount, 2);
  console.log("  PASS");
}

function testCancel() {
  console.log("TEST 8: queueCancel removes a queued task");
  const task = queueAdd(db, { prompt: "cancel me" });
  const cancelled = queueCancel(db, task.id);
  assert.equal(cancelled, true, "should return true for cancelled task");

  const gone = queueGet(db, task.id);
  assert.equal(gone, null, "cancelled task should be gone");
  console.log("  PASS");
}

function testCancelOnlyQueued() {
  console.log("TEST 9: queueCancel only cancels queued tasks, not processing/done");
  const task = queueAdd(db, { prompt: "in progress" });
  queueClaim(db, "worker-1");
  const cancelled = queueCancel(db, task.id);
  assert.equal(cancelled, false, "cannot cancel a processing task");

  const task2 = queueAdd(db, { prompt: "done task" });
  queueClaim(db, "worker-2");
  queueComplete(db, task2.id, "done");
  const cancelled2 = queueCancel(db, task2.id);
  assert.equal(cancelled2, false, "cannot cancel a done task");
  console.log("  PASS");
}

function testListAll() {
  console.log("TEST 10: queueList returns all tasks ordered by queued_at");
  queueAdd(db, { prompt: "a" });
  queueAdd(db, { prompt: "b" });
  queueAdd(db, { prompt: "c" });
  const all = queueList(db);
  assert.equal(all.length, 3);
  console.log("  PASS");
}

async function testListByStatus() {
  console.log("TEST 11: queueList filters by status");
  const t1 = queueAdd(db, { prompt: "queued-only" });
  await sleep(5);
  const t2 = queueAdd(db, { prompt: "will-be-done" });
  // Claim and complete t1, leave t2 queued
  const claimed = queueClaim(db, "worker-1");
  assert.equal(claimed!.id, t1.id, "should claim t1 first");
  queueComplete(db, t1.id, "done");

  const queued = queueList(db, "queued");
  assert.equal(queued.length, 1, "one queued task (t2)");
  assert.equal(queued[0].id, t2.id);

  const done = queueList(db, "done");
  assert.equal(done.length, 1, "one done task");
  assert.equal(done[0].id, t1.id);
  console.log("  PASS");
}

function testQueuePreservesData() {
  console.log("TEST 12: queue re-open preserves existing data (WAL mode)");
  const task = queueAdd(db, { prompt: "persistent", taskSlug: "survive-reopen" });
  const id = task.id;
  db.close();

  // Reopen same DB
  db = openQueue(dbPath);
  const reopened = queueGet(db, id);
  assert.ok(reopened, "task should survive reopen");
  assert.equal(reopened!.prompt, "persistent");
  assert.equal(reopened!.taskSlug, "survive-reopen");
  console.log("  PASS");
}

async function testClaimSkipsNonQueued() {
  console.log("TEST 13: queueClaim skips done/failed tasks, picks next queued");
  const t1 = queueAdd(db, { prompt: "already done" });
  await sleep(2);
  const t2 = queueAdd(db, { prompt: "next in line" });
  const first = queueClaim(db, "worker-1");
  assert.equal(first!.id, t1.id, "should claim t1 first");
  queueComplete(db, first!.id, "done");

  const claimed = queueClaim(db, "worker-2");
  assert.equal(claimed!.id, t2.id, "should skip done and claim next queued");
  console.log("  PASS");
}

function testOpenQueueIdempotent() {
  console.log("TEST 14: openQueue is idempotent — CREATE TABLE IF NOT EXISTS");
  const db2 = openQueue(dbPath);
  queueAdd(db2, { prompt: "after second open" });
  db2.close();
  // Original db still works
  const tasks = queueList(db);
  assert.ok(tasks.length >= 1, "original db still functional after second open");
  console.log("  PASS");
}

// ---- runner ----------------------------------------------------------------

async function runTests() {
  console.log("=== queue smoke tests ===\n");
  let pass = 0;
  let fail = 0;

  const tests: Array<() => Promise<void> | void> = [
    testAddAndGet,
    testAddWithOptionalFields,
    testGetMissing,
    testClaim,
    testClaimIsAtomic,
    testComplete,
    testFail,
    testCancel,
    testCancelOnlyQueued,
    testListAll,
    testListByStatus,
    testQueuePreservesData,
    testClaimSkipsNonQueued,
    testOpenQueueIdempotent,
  ];

  for (const test of tests) {
    try {
      setup();
      await test();
      pass++;
      console.log("");
    } catch (e: any) {
      fail++;
      console.log(`  FAIL: ${e.message}\n`);
    } finally {
      teardown();
    }
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});