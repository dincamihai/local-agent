---
column: Backlog
---

# Test: command injection in acquireGlobalSlot
# Test: command injection in acquireGlobalSlot

**Severity:** High

## Bug

Line 41: `instanceId` interpolated directly into shell command without sanitization:

```javascript
writeFileSync(`${GLOBAL_SLOTS_DIR}/${process.pid}-${instanceId}`, "");
```

## How to reproduce

```javascript
pi_start({ workspace: "/repo", name: "test; rm -rf /tmp" })
// Results in path: /tmp/pi-bridge-slots/123-test; rm -rf /tmp
```

## Test to write

Test with malicious instanceId containing:
1. Shell metacharacters: `;`, `|`, `&`, `$`, backticks
2. Path traversal: `../`, `..\\`
3. Newline injection: `\n`, `\r`
4. Verify slot file created safely, no command execution

## Fix approach

Sanitize instanceId or use path.join() + validate against whitelist.

## File

`pi-bridge-mcp.test.ts`
