---
column: Done
created: 2026-04-19
order: 2
---

# local-agent: fix worktree feature follow-ups

Four issues found during review of commit cfd0a53 (auto git worktree).

## 1. Restore try/catch fallback (high priority)

**File:** `pi-bridge-mcp.ts` ~line 89
**Problem:** Worktree creation can throw uncaught — `git worktree add` failure kills the container start.

**Fix:** Wrap the worktree block in try/catch, log stderr, fall back to no write mount:
```ts
let editDir: string | undefined;
if (workDir && !editDir) {
  try { /* create worktree, set editDir = worktreePath */ }
  catch (e: any) {
    process.stderr.write(`[pi-bridge] worktree creation failed, no write mount: ${e.message}\n`);
  }
}
```

## 2. Unify execSync usage

**File:** `pi-bridge-mcp.ts` ~lines 13, 92-93, 175
**Problem:** Import removed `execSync` but code uses `require("child_process").execSync` inline.

**Fix:** Restore `execSync` to the import, revert all inline `require` calls to just `execSync`.

## 3. Revert worktree fields to private

**File:** `pi-bridge-mcp.ts` ~lines 80-81
**Problem:** `worktreePath` and `worktreeWorkDir` changed from `private` to public with no justification.

**Fix:** Revert to `private`. They are only used internally.

## 4. Add tests

**File:** `pi-bridge-mcp.test.ts` (new)
**Test 4 scenarios:**
- Happy path: workspace is a git repo → worktree created, mounted, cleaned up
- Not a git repo: workspace is not a git repo → no worktree, no error
- Explicit editdir: overrides worktree auto-create
- Failed creation: `git worktree add` fails → falls back to no write mount

## Result

All 4 fixes applied:

1. **try/catch fallback** — wrapped the worktree creation block (lines 90-101) in try/catch; on failure logs `[pi-bridge] worktree creation failed, no write mount: <msg>` to stderr and continues without a write mount.

2. **Unified execSync** — restored `execSync` to the `child_process` import (line 13); replaced all 4 occurrences of `require("child_process").execSync` with plain `execSync` (lines 89, 94, 95, 180).

3. **Reverted to private** — `worktreePath` and `worktreeWorkDir` on lines 80-81 are `private` again.

4. **Added tests** — created `./pi-bridge-mcp.test.ts` with 4 scenarios: happy path worktree creation, non-git workspace (no worktree), explicit editdir override, and failed worktree creation fallback.
