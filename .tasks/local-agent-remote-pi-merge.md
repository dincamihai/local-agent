---
column: Backlog
parent: local-agent-remote-execution
part: 3/4
depends_on: local-agent-remote-pi-start
---

# Remote agent: pi_merge remote mode (git fetch + merge)
## Goal

Make `pi_merge` detect remote mode from saved state and perform `git fetch` + merge instead of worktree merge.

## Changes in pi-bridge-mcp.ts

### Load mode from state
```ts
const state = loadState();
const isRemote = state?.mode === "remote";
const repoBranch = state?.repoBranch;
```

### pi_merge handler branch
```ts
if (isRemote) {
  if (!repoBranch) {
    return { content: [{ type: "text", text: "Remote mode: no branch in state." }], isError: true };
  }
  // Determine local repo path — use workspace param or cwd
  const repoPath = workspace ?? process.cwd();
  try {
    execSync(`git -C ${repoPath} fetch origin ${repoBranch}`, { stdio: "pipe" });
    execSync(`git -C ${repoPath} merge --no-ff origin/${repoBranch} -m "Merge remote agent branch ${repoBranch}"`, { stdio: "pipe" });
    execSync(`git -C ${repoPath} push origin --delete ${repoBranch}`, { stdio: "pipe" });
    return { content: [{ type: "text", text: `Merged remote branch ${repoBranch} and deleted it.` }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Remote merge failed: ${e.message}` }], isError: true };
  }
} else {
  // existing local worktree merge
  const info = pi.getWorktreeInfo();
  // ...existing code...
}
```

### pi_merge tool schema — add workspace param
```ts
workspace: z.string().optional().describe("Local repo path for remote mode merge (default: cwd)"),
```

### State schema update
`loadState()` must return `mode` and `repoBranch` fields — ensure `saveState` in subtask 2 is merged first.

## Notes
- `execSync` already used in file — consistent pattern
- Branch deletion after merge is best-effort (don't fail if push --delete errors)
- Local mode: zero change

## Part of
`local-agent-remote-execution` — subtask 3/4

## Depends on
`local-agent-remote-pi-start` (subtask 2)
