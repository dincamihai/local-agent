---
column: Backlog
---

# Test: pi_set_model error handling
# Test: pi_set_model error handling

**Severity:** Low

## Bug

Lines 984-996: No tests verify behavior when `client.setModel()` throws or returns unexpected data.

## Test to write

Test `pi_set_model` with:
1. Client not running — should return error
2. RPC returning error — should propagate error message
3. Invalid provider/model combinations — should validate
4. Missing instance_id — should handle gracefully

## File

`pi-bridge-mcp.test.ts`
