---
column: Backlog
parent: local-agent-remote-execution
part: 4/4
depends_on: local-agent-remote-pi-start
---

# Remote agent: HTTP status endpoint in pi_bridge
## Goal

Add `GET /api/status/:containerName` endpoint to pi_bridge HTTP server so remote Monitor can poll completion without access to `/tmp/` sentinel files.

## Changes in pi-bridge-mcp.ts

### In-memory status store
```ts
const agentStatusMap = new Map<string, { done: boolean; error: string | null; ts: number }>();
```

### Update onAgentEnd to populate map
```ts
pi.onAgentEnd = (error) => {
  if (pi.containerName) {
    const status = { done: true, error: error ?? null, ts: Date.now() };
    agentStatusMap.set(pi.containerName, status);
    // existing sentinel file write
    try { writeFileSync(`/tmp/${pi.containerName}.status`, JSON.stringify(status)); } catch {}
  }
  sendResourceUpdated("pi://agent/status");
};
```

### Add Express route (HTTP mode only)
pi_bridge already has an Express app in HTTP mode (`PI_BRIDGE_HTTP=1`). Find where routes are registered and add:
```ts
app.get("/api/status/:name", (req, res) => {
  const status = agentStatusMap.get(req.params.name);
  if (!status) {
    res.json({ done: false, error: null, ts: null });
  } else {
    res.json(status);
  }
});
```

### pi_start response for remote mode (update subtask 2 response text)
Include HTTP polling command:
```
Monitor command: until curl -sf http://<host>:<port>/api/status/<name> | grep -q '"done":true'; do sleep 2; done
```

### Cleanup on pi_stop
```ts
if (pi.containerName) agentStatusMap.delete(pi.containerName);
```

## Notes
- HTTP mode already exists — find `PI_BRIDGE_HTTP` branch in pi-bridge-mcp.ts
- Sentinel file still written for local mode compatibility
- No auth on status endpoint (add in future if needed)
- `agentStatusMap` is in-process memory — restarting pi_bridge loses status; acceptable for now

## Part of
`local-agent-remote-execution` — subtask 4/4

## Depends on
`local-agent-remote-pi-start` (subtask 2)
