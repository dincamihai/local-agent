---
column: Backlog
---

# Smoke test: parallel agent limit

Verify `PARALLEL_LIMIT` enforced machine-wide.

## How it works

Slot directory enforces machine-wide concurrency across all `pi-bridge-mcp.ts` processes:

1. **acquireGlobalSlot** — scans `/tmp/pi-bridge-slots/`, evicts dead-PID files, counts live slots
2. If count < `PARALLEL_LIMIT` → creates slot file `/tmp/pi-bridge-slots/<pid>-<instanceId>`
3. If count >= limit → rejects `pi_start`
4. **releaseGlobalSlot** — deletes slot file on `pi_stop` or process exit

Self-heals after crashes by checking if PID in slot file is still alive.

## Status

**NOT COVERED** — needs new tests.

## Test cases

1. **Slot acquisition** — count < limit → slot acquired, file created in `/tmp/pi-bridge-slots/`
2. **Slot full** — count >= limit → `pi_start` rejected
3. **Dead PID cleanup** — stale PID files evicted before count check
4. **Slot release** — `pi_stop` → file deleted, count decremented

## File

`pi-bridge-mcp.test.ts`
