---
column: Backlog
---

# Test: hardcoded paths not configurable
# Test: hardcoded paths not configurable

**Severity:** Low

## Bug

Multiple hardcoded paths without env var overrides:

| Line | Path |
|------|------|
| 36 | `GLOBAL_SLOTS_DIR = "/tmp/pi-bridge-slots"` |
| 203 | `/tmp/pi-worktrees/` |
| 225-227 | `/root/.pi/agent/models.json` |

## Impact

Cannot run where `/tmp` is read-only or different mount.

## Test to write

Test with custom paths via env vars:
1. `PI_BRIDGE_SLOTS_DIR=/custom/path`
2. `PI_BRIDGE_WORKTREE_DIR=/custom/wt`
3. Verify all operations work with custom paths

## File

`pi-bridge-mcp.test.ts`
