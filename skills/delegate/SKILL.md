---
name: delegate
description: Delegate a task card to the local qwen agent via pi_bridge MCP. Use this skill whenever the user says "delegate", types /delegate, or when a task is mechanical and medium-complexity (a single well-defined fix, a file transform, a test run, a code scaffold, summarising content, or finding/locating something in the codebase that would consume a lot of tokens) and doesn't require broad judgment across many files. Proactively suggest delegating when you see a .tasks/*.md card that fits this profile — don't wait to be asked. Do NOT use for tasks that touch many files simultaneously, require architectural decisions, or need Claude's judgment to navigate ambiguity.
---

# Delegate Task to Local Agent

Delegates a kanban task card to the local qwen3.6 agent running in a container via pi_bridge MCP.

## When this fits

- Task has a `.tasks/*.md` card with a clear definition of done
- Work is mechanical: fix a bug, run tests, apply a known pattern, transform a file, summarise content, or locate something in the codebase (avoids flooding the main context)
- Medium complexity — a few files at most, not a broad refactor
- Doesn't require judgment calls about design or architecture

## Step 1 — Prepare the card

Read the task card and move it to In Progress:

```
- Read .tasks/<slug>.md
- Update frontmatter: column: In Progress
```

## Step 2 — Start the agent

```
pi_start({
  workspace: "/path/to/<project>",
  task: "/path/to/<project>/.tasks/<slug>.md",
  // omit editdir — pi_start auto-creates a git worktree branch for edits
})
```

`pi_start` returns immediately — the container boots in the background. When `workspace` is a git repo, a `pi/<name>-<timestamp>` branch + worktree is auto-created under `/tmp/pi-worktrees/`. Agent edits land there, isolated from main. The response includes the exact `podman logs -f <name>` command to tail logs. Share it with the user so they can watch if they want.

## Step 3 — Send the task prompt

```
pi_prompt("Read /task.md for your assignment.
- /context is the repo, read-only reference
- /workspace is your working copy — make all edits here
Complete the task. When done, update /task.md: set column: Done in the frontmatter
and append a ## Result section summarising what you did.")
```

`pi_prompt` returns immediately — the agent works in the background.

## Step 4 — Monitor (optional)

Use the `Monitor` tool with a **tight grep filter** — the agent streams raw JSON including thinking tokens, which flood the monitor and get suppressed. Only match structural events:

```
Monitor({
  description: "pi agent: <slug>",
  timeout_ms: 600000,
  persistent: false,
  command: `podman logs -f <container-name> 2>&1 | grep --line-buffered -E '"toolName":"write"|"toolName":"bash"|turn_end|column.*Done|## Result'`
})
```

**Why this filter works:**
- `"toolName":"write"` — fires when agent writes a file
- `"toolName":"bash"` — fires when agent runs a command
- `turn_end` — fires at end of each agent turn (low frequency)
- `column.*Done|## Result` — fires when task card is marked done

**Do NOT** grep for thinking content (`thinking_delta`, keywords from the task) — these produce hundreds of events per second and get auto-suppressed.

Other ways to check progress:
- **Direct logs**: `podman logs --tail 50 <container-name>` for a snapshot
- **State**: `pi_state()` — returns running bool + message count
- **Filesystem**: read changed files in worktree as they land (`/tmp/pi-worktrees/<slug>/`)

## Step 5 — Collect results

```
pi_wait()    // blocks until agent is idle
pi_result()  // get final text response
```

## Step 6 — Merge worktree back

```
pi_merge()   // commits any uncommitted edits, merges worktree branch → main, removes worktree
pi_stop()    // clean up container
```

`pi_merge` accepts optional params:
- `commit_message`: override auto-generated commit message
- `keep_branch`: set `true` to skip branch deletion after merge

**Always call `pi_merge` before `pi_stop`** when the agent wrote code. `pi_stop` without `pi_merge` discards uncommitted worktree edits.

## Step 7 — Integrate

- Agent updated `/task.md` (column + result section)
- Review merged changes in the repo (`git log`, `git diff HEAD~1`)
- If agent wrote artifacts, check `/output`

## Permission model

| Mount | Container path | Access | When to grant |
|-------|---------------|--------|---------------|
| workspace (repo) | `/context` | read-only | always |
| task file | `/task.md` | read-write | always |
| worktree (auto) or editdir | `/workspace` | read-write | auto when workspace is git repo |
| output | `/output` | read-write | always |

Agent edits go to `/workspace`. `/context` is read-only reference — agent must never try to write there.

## Escalation

If the agent gets stuck or produces poor output:
- `pi_steer("focus on X, ignore Y")` — redirect mid-task
- `pi_abort()` — abort and handle it yourself or escalate to a Claude subagent
- Move card back to Backlog with a note explaining the blocker
