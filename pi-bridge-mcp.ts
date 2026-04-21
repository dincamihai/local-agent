#!/usr/bin/env npx tsx
/**
 * MCP server that wraps pi-coding-agent's RPC mode.
 * Gives Claude native tool access to control a local pi agent (gemma4).
 *
 * Usage (stdio):  npx tsx pi-bridge-mcp.ts
 * Usage (HTTP):   PI_BRIDGE_HTTP=1 PI_BRIDGE_PORT=3200 npx tsx pi-bridge-mcp.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { spawn, execSync, type ChildProcess } from "child_process";
import { writeFileSync, readFileSync, renameSync, unlinkSync } from "fs";
import { StringDecoder } from "string_decoder";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DOCKER_IMAGE = process.env.PI_DOCKER_IMAGE ?? "local-agent";
const DEFAULT_MODEL = process.env.PI_MODEL ?? "qwen3.6:35b-a3b-q8_0";
const DEFAULT_TIMEOUT = 300_000; // 5 minutes
export const LOCAL_AGENT_DIR = process.env.PI_LOCAL_AGENT_DIR ?? SCRIPT_DIR;
export const OUTPUT_DIR = process.env.PI_OUTPUT_DIR ?? join(LOCAL_AGENT_DIR, "output");
const STATE_FILE = process.env.PI_STATE_FILE ?? `/tmp/pi-bridge-state-${process.pid}.json`;

// ---------------------------------------------------------------------------
// Log resource: subscribable container logs at pi://logs/current
// ---------------------------------------------------------------------------

const LOG_RING_SIZE = 200;  // keep last ~200 lines in memory
const LOG_BUFFER: string[] = [];
let logTailProc: ChildProcess | null = null;
let lastLogNotificationTs = 0;  // throttle: last notification timestamp
const LOG_NOTIFICATION_INTERVAL = 500;  // ms between log notifications

/** Ring-buffer push: drop oldest if full */
function logPush(line: string): void {
  LOG_BUFFER.push(line);
  if (LOG_BUFFER.length > LOG_RING_SIZE) {
    LOG_BUFFER.shift();
  }
}

/** Stop the log-tail child process and clear the buffer */
function stopLogTail(): void {
  if (logTailProc) {
    logTailProc.kill("SIGTERM");
    logTailProc = null;
  }
  LOG_BUFFER.length = 0;
  lastLogNotificationTs = 0;
}

/** Return ring buffer contents joined as a readable string */
function getRecentLogs(): string {
  return LOG_BUFFER.join("\n");
}

/** Begin tailing podman logs for the given container */
function startLogTail(
  containerName: string,
  notify?: (params: { uri: string }) => void,
): void {
  stopLogTail(); // safety: stop any previous tail
  logTailProc = spawn("podman", ["logs", "-f", containerName], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  logTailProc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split("\n")) {
      if (line.length > 0) logPush(line);
    }
    // Throttled notification: max 1 per 500ms
    if (notify) {
      const now = Date.now();
      if (now - lastLogNotificationTs >= LOG_NOTIFICATION_INTERVAL) {
        lastLogNotificationTs = now;
        notify({ uri: "pi://logs/current" });
      }
    }
  });
  logTailProc.stderr?.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) process.stderr.write(`[pi-bridge log tail] ${msg}\n`);
  });
}

// ---------------------------------------------------------------------------
// Resource subscription tracking
// ---------------------------------------------------------------------------

/** Set of currently subscribed resource URIs */
const subscribedResources = new Set<string>();

/** Send a resource update notification only if the URI is subscribed.
 *  Logs to stderr for verification. Returns true if a notification was sent. */
function sendResourceUpdated(uri: string): void {
  if (!subscribedResources.has(uri)) {
    return;
  }
  process.stderr.write(
    `[pi-bridge] sendResourceUpdated: ${uri} (subscribers: ${subscribedResources.size})\n`
  );
  server.server.sendResourceUpdated({ uri });
}

// ---------------------------------------------------------------------------
// LF-only JSONL reader (mirrors pi's own jsonl.js — avoids readline U+2028 bug)
// ---------------------------------------------------------------------------

function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): () => void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const onData = (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  };
  const onEnd = () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      onLine(buffer);
      buffer = "";
    }
  };
  stream.on("data", onData);
  stream.on("end", onEnd);
  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}

// ---------------------------------------------------------------------------
// Lightweight RPC client (manages docker run -i with --mode rpc)
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
}

class PiRpcClient {
  private proc: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private events: any[] = [];
  private lastAssistantText: string | null = null;
  private _isStreaming = false;
  private _promptPending = false; // true after prompt() until agent_end
  private idlePromise: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private stopReading: (() => void) | null = null;
  containerName: string | null = null;
  private worktreePath: string | null = null;
  private worktreeWorkDir: string | null = null;
  private worktreeBranch: string | null = null;

  // Agent-end callback: fired when the agent finishes (or fails)
  onAgentEnd?: (error?: string) => void;

  async start(workDir?: string, taskFile?: string, editDir?: string, name?: string): Promise<void> {
    if (this.proc) return;

    this.containerName = name ?? `pi-agent-${Date.now()}`;

    // Auto-create a git worktree if workDir is a git repo and no editDir was passed
    if (workDir && !editDir && (() => { try { execSync(`git -C ${workDir} rev-parse --git-dir`, {stdio:"ignore"}); return true; } catch { return false; } })()) {
      let worktreePath: string | undefined;
      try {
        const branch = `pi/${name}-${Date.now()}`;
        worktreePath = `/tmp/pi-worktrees/${branch.replace(/\//g, "-")}`;
        execSync("mkdir -p /tmp/pi-worktrees");
        execSync(`git -C ${workDir} worktree add ${worktreePath} -b ${branch}`);
        this.worktreePath = worktreePath;
        this.worktreeWorkDir = workDir;
        this.worktreeBranch = branch;
        editDir = worktreePath;
      } catch (e: any) {
        process.stderr.write(`[pi-bridge] worktree creation failed, no write mount: ${e.message}\n`);
      }
    }

    const mounts: string[] = [];
    if (workDir) mounts.push("-v", `${workDir}:/context:ro`);
    if (editDir) mounts.push("-v", `${editDir}:/workspace:rw`);
    if (taskFile) mounts.push("-v", `${taskFile}:/task.md:rw`);
    mounts.push("-v", `${OUTPUT_DIR}:/output`);

    this.proc = spawn("podman", [
      "run", "--rm", "-i",
      "--name", this.containerName,
      ...mounts,
      "-v", `${LOCAL_AGENT_DIR}/pi-models.json:/root/.pi/agent/models.json:ro`,
      "-v", `${LOCAL_AGENT_DIR}/pi-settings.json:/root/.pi/agent/settings.json:ro`,
      "-v", `${LOCAL_AGENT_DIR}/lance-extension.ts:/ext/lance-extension.ts:ro`,
"-v", `${LOCAL_AGENT_DIR}/membrain-extension.ts:/ext/membrain-extension.ts:ro`,
      "-e", `MEMORY_BACKEND=${process.env.MEMORY_BACKEND ?? "lance"}`,
      "--add-host=host.containers.internal:host-gateway",
      "--add-host=host.docker.internal:host-gateway",
      DOCKER_IMAGE,
      "--mode", "rpc",
      "--model", DEFAULT_MODEL,
      "--no-session",
      "--tools", "read,write,bash,grep,find",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    // LF-only JSONL reader (not readline — it splits on U+2028/U+2029)
    this.stopReading = attachJsonlReader(this.proc.stdout!, (line) => {
      this.handleLine(line);
    });

    this.proc.stderr?.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) process.stderr.write(`[pi-stderr] ${msg}\n`);
    });

    this.proc.on("exit", (code) => {
      this.proc = null;
      this.containerName = null;
      this._isStreaming = false;
      clearState();
      for (const [, req] of this.pending) {
        req.reject(new Error(`pi process exited with code ${code}`));
      }
      this.pending.clear();
      if (this.idlePromise) {
        this.idlePromise.resolve();
        this.idlePromise = null;
      }
    });

    // Spawn only — caller must await ensureReady() before prompting
  }

  async ensureReady(maxWaitMs = 30_000): Promise<void> {
    if (!this.proc) throw new Error("pi process not started");
    await this.waitForReady(maxWaitMs);
  }

  private async waitForReady(maxWaitMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!this.proc || this.proc.exitCode !== null) {
        throw new Error("pi process exited during startup");
      }
      try {
        await this.send("get_state");
        return; // pi responded — it's ready
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`pi did not become ready within ${maxWaitMs}ms`);
  }

  getWorktreeInfo(): { path: string; workDir: string; branch: string } | null {
    if (!this.worktreePath || !this.worktreeWorkDir || !this.worktreeBranch) return null;
    return { path: this.worktreePath, workDir: this.worktreeWorkDir, branch: this.worktreeBranch };
  }

  mergeWorktree(commitMessage?: string, deleteBranch = true): string {
    if (!this.worktreePath || !this.worktreeWorkDir || !this.worktreeBranch) {
      return "No worktree to merge.";
    }
    const { worktreePath, worktreeWorkDir, worktreeBranch } = this as any;
    const msgs: string[] = [];

    // Commit any uncommitted changes in the worktree
    try {
      const status = execSync(`git -C ${worktreePath} status --porcelain`).toString().trim();
      if (status) {
        execSync(`git -C ${worktreePath} add -A`);
        const msg = commitMessage ?? `pi: agent changes from ${worktreeBranch}`;
        execSync(`git -C ${worktreePath} commit -m ${JSON.stringify(msg)}`);
        msgs.push(`Committed worktree changes: "${msg}"`);
      } else {
        msgs.push("Worktree clean — nothing to commit.");
      }
    } catch (e: any) {
      msgs.push(`Commit step: ${e.message}`);
    }

    // Merge branch into base repo
    try {
      execSync(`git -C ${worktreeWorkDir} merge --no-ff ${worktreeBranch} -m ${JSON.stringify(`Merge ${worktreeBranch}`)}`);
      msgs.push(`Merged ${worktreeBranch} into base repo.`);
    } catch (e: any) {
      msgs.push(`Merge failed: ${e.message}`);
      return msgs.join("\n");
    }

    // Remove worktree
    try {
      execSync(`git -C ${worktreeWorkDir} worktree remove --force ${worktreePath}`);
      msgs.push(`Worktree removed: ${worktreePath}`);
    } catch (e: any) {
      msgs.push(`Worktree remove failed: ${e.message}`);
    }

    // Delete branch
    if (deleteBranch) {
      try {
        execSync(`git -C ${worktreeWorkDir} branch -d ${worktreeBranch}`);
        msgs.push(`Branch deleted: ${worktreeBranch}`);
      } catch (e: any) {
        msgs.push(`Branch delete failed: ${e.message}`);
      }
    }

    this.worktreePath = null;
    this.worktreeWorkDir = null;
    this.worktreeBranch = null;
    return msgs.join("\n");
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.stopReading?.();
    this.stopReading = null;

    // Remove worktree without merging (call pi_merge first to preserve changes)
    if (this.worktreePath && this.worktreeWorkDir) {
      try { execSync(`git -C ${this.worktreeWorkDir} worktree remove --force ${this.worktreePath}`); } catch {}
      this.worktreePath = null;
      this.worktreeWorkDir = null;
      this.worktreeBranch = null;
    }

    this.proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.proc?.kill("SIGKILL");
        resolve();
      }, 5000);
      this.proc?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.proc = null;
  }

  get isRunning(): boolean {
    return this.proc !== null;
  }

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    // Handle response to a command we sent
    if (msg.type === "response" && msg.id != null) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.success === false) {
          pending.reject(new Error(msg.error ?? "RPC command failed"));
        } else {
          pending.resolve(msg.data ?? null);
        }
      }
      return;
    }

    // Handle events (pi emits events with type: "agent_start", "message_update", etc.)
    this.events.push(msg);

    if (msg.type === "agent_start") {
      this._isStreaming = true;
    }

    // Capture assistant text from message_update text_delta events
    if (msg.type === "message_update" && msg.assistantMessageEvent) {
      const evt = msg.assistantMessageEvent;
      if (evt.type === "text_delta" && evt.delta) {
        if (this.lastAssistantText === null) this.lastAssistantText = "";
        this.lastAssistantText += evt.delta;
      }
    }

    // Also capture from agent_end which includes full messages
    if (msg.type === "auto_retry_end" && msg.success === false) {
      // Final failure after all retries exhausted
      this._isStreaming = false;
      this._promptPending = false;
      this.lastAssistantText = null;

      const errorMessage = msg.finalError ?? msg.error ?? "All retries exhausted";
      this.idlePromise?.resolve();
      this.idlePromise = null;

      // Fire the onAgentEnd callback
      this.onAgentEnd?.(errorMessage);
      return;
    }

    if (msg.type === "agent_end") {
      // Determine if this was an error completion by inspecting the last assistant message
      let errorMessage: string | undefined;
      const lastMsg = msg.messages?.findLast?.((m: any) => m.role === "assistant");
      if (lastMsg?.stopReason === "error" && lastMsg?.errorMessage) {
        errorMessage = lastMsg.errorMessage;
      }

      // Extract text from the final messages if we missed deltas
      if (this.lastAssistantText === null && msg.messages) {
        for (const m of msg.messages) {
          if (m.role === "assistant") {
            for (const c of m.content ?? []) {
              if (c.type === "text" && c.text) {
                this.lastAssistantText = (this.lastAssistantText ?? "") + c.text;
              }
            }
          }
        }
      }
      this._isStreaming = false;
      this._promptPending = false;
      if (this.idlePromise) {
        this.idlePromise.resolve();
        this.idlePromise = null;
      }

      // Fire the onAgentEnd callback (passing error message if there was one)
      this.onAgentEnd?.(errorMessage);
    }
  }

  private send(type: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(new Error("pi process not running"));
    }
    const id = ++this.requestId;
    const msg = JSON.stringify({ id, type, ...params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(msg + "\n");
    });
  }

  async prompt(message: string): Promise<void> {
    this.lastAssistantText = null;
    this.events = [];
    this._promptPending = true;
    await this.send("prompt", { message });
  }

  async steer(message: string): Promise<void> {
    await this.send("steer", { message });
  }

  async followUp(message: string): Promise<void> {
    await this.send("follow_up", { message });
  }

  async abort(): Promise<void> {
    await this.send("abort");
  }

  async getState(): Promise<any> {
    return this.send("get_state");
  }

  async setModel(provider: string, modelId: string): Promise<any> {
    return this.send("set_model", { provider, modelId });
  }

  async compact(customInstructions?: string): Promise<any> {
    return this.send("compact", customInstructions ? { customInstructions } : {});
  }

  waitForIdle(timeout = DEFAULT_TIMEOUT): Promise<void> {
    if (!this._isStreaming && !this._promptPending) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.idlePromise = { resolve, reject };
      const timer = setTimeout(() => {
        this.idlePromise = null;
        reject(new Error(`Timed out after ${timeout}ms`));
      }, timeout);
      // Clean up timer on resolve
      const origResolve = this.idlePromise.resolve;
      this.idlePromise.resolve = () => {
        clearTimeout(timer);
        origResolve();
      };
    });
  }

  getResult(): string | null {
    return this.lastAssistantText;
  }

  getEvents(): any[] {
    return [...this.events];
  }

  clearEvents(): void {
    this.events = [];
  }
}

// ---------------------------------------------------------------------------
// State persistence (survives MCP server restarts)
// ---------------------------------------------------------------------------

interface SavedState {
  containerName: string;
  worktreePath: string | null;
  worktreeWorkDir: string | null;
  worktreeBranch: string | null;
  pid: number;
}

function saveState(state: SavedState): void {
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

function clearState(): void {
  try { unlinkSync(STATE_FILE); } catch {}
}

function cleanupStaleInstances(): void {
  const myPid = process.pid;

  // Kill truly orphaned pi-bridge processes (ppid <= 1 = reparented to init, parent died)
  try {
    const out = execSync(`pgrep -f 'pi-bridge-mcp.ts'`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const pids = out.split("\n").map(p => parseInt(p.trim())).filter(p => p && p !== myPid);
    let killed = 0;
    for (const pid of pids) {
      try {
        const ppid = parseInt(execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf-8" }).trim());
        if (ppid <= 1) {
          process.kill(pid, "SIGTERM");
          killed++;
        }
      } catch {}
    }
    if (killed > 0) process.stderr.write(`[pi-bridge] Killed ${killed} orphaned MCP process(es)\n`);
  } catch {}

  // Clean up containers owned by dead instances via per-PID state files
  try {
    const files = execSync(`ls /tmp/pi-bridge-state-*.json 2>/dev/null`, { encoding: "utf-8" })
      .trim().split("\n").filter(Boolean);
    for (const file of files) {
      try {
        const state: SavedState = JSON.parse(readFileSync(file, "utf-8"));
        try {
          process.kill(state.pid, 0); // throws if process is dead
        } catch {
          try { execSync(`podman stop ${state.containerName}`, { stdio: "ignore" }); } catch {}
          process.stderr.write(`[pi-bridge] Stopped orphaned container: ${state.containerName}\n`);
          unlinkSync(file);
        }
      } catch {}
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

cleanupStaleInstances();
const pi = new PiRpcClient();

const server = new McpServer({
  name: "pi-bridge",
  version: "1.0.0",
});

// Enable subscription support — the high-level McpServer API doesn't expose this;
// use the low-level inner server to set the capability flag.
server.server.registerCapabilities({ resources: { subscribe: true } });

// Register the container-logs resource
server.resource("pi-logs", "pi://logs/current", async () => ({
  contents: [{ uri: "pi://logs/current", text: getRecentLogs() }],
}));

// Register the agent-status resource
server.resource("pi-status", "pi://agent/status", async () => ({
  contents: [{ uri: "pi://agent/status", text: JSON.stringify({
    running: pi.isRunning,
    streaming: pi.isStreaming,
  })}],
}));

// --- Resource subscription handlers (low-level) ---

server.server.setRequestHandler(
  SubscribeRequestSchema,
  async (req) => {
    const uri = req.params.uri;
    subscribedResources.add(uri);
    process.stderr.write(`[pi-bridge] resources/subscribe: ${uri}\n`);
    return {};
  }
);

server.server.setRequestHandler(
  UnsubscribeRequestSchema,
  async (req) => {
    const uri = req.params.uri;
    subscribedResources.delete(uri);
    process.stderr.write(`[pi-bridge] resources/unsubscribe: ${uri}\n`);
    return {};
  }
);

// Wire the agent-end callback: write sentinel file + emit MCP notification
pi.onAgentEnd = (error) => {
  if (pi.containerName) {
    const sentinel = `/tmp/${pi.containerName}.status`;
    try {
      writeFileSync(sentinel, JSON.stringify({ done: true, error: error ?? null, ts: Date.now() }));
    } catch {}
  }
  sendResourceUpdated("pi://agent/status");
};

// -- Lifecycle tools --

server.tool(
  "pi_start",
  "Start the pi agent. Must be called before other pi_ tools. Mounts: /context (read-only repo reference), /workspace (read-write, auto-created git worktree or explicit editdir), /task.md (task card). Agent edits go to /workspace — never touches /context. The container is named after the task slug (e.g. pi-board-tui-scaffold) so you can run 'podman logs -f <name>' to tail logs.",
  {
    workspace: z.string().optional().describe("Host repo directory — mounted read-only at /context. If it is a git repo, a worktree is auto-created and mounted read-write at /workspace."),
    task: z.string().optional().describe("Host path to a task .md file to mount as /task.md (read-write)"),
    editdir: z.string().optional().describe("(Deprecated) Explicit host directory to mount as /workspace (read-write). Overrides auto-worktree. Only use when workspace is not a git repo."),
  },
  async ({ workspace, task, editdir }) => {
    try {
      const taskSlug = task ? basename(task, ".md") : null;
      const workspaceBase = workspace ? basename(workspace) : null;
      const name = `pi-${taskSlug ?? workspaceBase ?? Date.now()}`;
      await pi.start(workspace, task, editdir, name);
      // Persist state so a restarted MCP server can clean up
      const wtInfo = pi.getWorktreeInfo();
      saveState({
        containerName: pi.containerName!,
        worktreePath: wtInfo?.path ?? null,
        worktreeWorkDir: wtInfo?.workDir ?? null,
        worktreeBranch: wtInfo?.branch ?? null,
        pid: process.pid,
      });
      startLogTail(pi.containerName!, () => {
        sendResourceUpdated("pi://logs/current");
      });
      // Notify client that the resources are available with fresh data
      sendResourceUpdated("pi://logs/current");
      const sentinel = `/tmp/${pi.containerName!}.status`;
      return { content: [{ type: "text", text: `Pi agent starting as container '${name}'. Use pi_prompt or pi_prompt_and_wait — they will wait for readiness automatically.\n\nNon-blocking completion: watch sentinel file '${sentinel}' — written when agent finishes.\nMonitor command: until [ -f ${sentinel} ]; do sleep 1; done && cat ${sentinel}` }] };

    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to start: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_stop",
  "Stop the pi agent and clean up the Docker container. If a worktree was auto-created, call pi_merge first to preserve agent changes before stopping.",
  {},
  async () => {
    const name = pi.containerName;
    stopLogTail();
    await pi.stop();
    clearState();
    if (name) {
      try { unlinkSync(`/tmp/${name}.status`); } catch {}
    }
    return { content: [{ type: "text", text: "Pi agent stopped." }] };
  }
);

server.tool(
  "pi_merge",
  "Commit any uncommitted agent edits in the worktree, merge the worktree branch back into the base repo, then remove the worktree. Call this after pi_wait/pi_result and before pi_stop.",
  {
    commit_message: z.string().optional().describe("Commit message for uncommitted worktree changes (default: auto-generated)"),
    keep_branch: z.boolean().optional().describe("Keep the worktree branch after merge (default: false — branch is deleted)"),
  },
  async ({ commit_message, keep_branch }) => {
    const info = pi.getWorktreeInfo();
    if (!info) {
      return { content: [{ type: "text", text: "No active worktree. Nothing to merge." }] };
    }
    const result = pi.mergeWorktree(commit_message, !keep_branch);
    return { content: [{ type: "text", text: result }] };
  }
);

// -- Task tools --

server.tool(
  "pi_prompt",
  "Send a task/prompt to the pi agent. The agent starts working asynchronously. Use pi_wait to block until done, then pi_result to get the output.",
  { message: z.string().describe("The task or prompt to send to the agent") },
  async ({ message }) => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running. Call pi_start first." }], isError: true };
    }
    try {
      await pi.ensureReady();
      await pi.prompt(message);
      return { content: [{ type: "text", text: "Prompt sent. Agent is working. Use pi_wait to wait for completion." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_prompt_and_wait",
  "Send a task to the pi agent and wait for it to finish. Returns the agent's final text response. This is the simplest way to delegate a task.",
  {
    message: z.string().describe("The task or prompt to send"),
    timeout: z.number().optional().describe("Max wait time in ms (default 300000 = 5min)"),
  },
  async ({ message, timeout }) => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running. Call pi_start first." }], isError: true };
    }
    try {
      await pi.ensureReady();
      await pi.prompt(message);
      await pi.waitForIdle(timeout ?? DEFAULT_TIMEOUT);
      const result = pi.getResult();
      return { content: [{ type: "text", text: result ?? "(no output)" }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_steer",
  "Send a steering message to redirect the agent mid-task. Delivered after current tool calls finish, before the next LLM call.",
  { message: z.string().describe("Steering instruction") },
  async ({ message }) => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await pi.steer(message);
      return { content: [{ type: "text", text: "Steering message queued." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_follow_up",
  "Queue a follow-up message to be processed after the agent finishes its current task.",
  { message: z.string().describe("Follow-up instruction") },
  async ({ message }) => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await pi.followUp(message);
      return { content: [{ type: "text", text: "Follow-up queued." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_abort",
  "Abort the agent's current operation immediately.",
  {},
  async () => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await pi.abort();
      return { content: [{ type: "text", text: "Aborted." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// -- State tools --

server.tool(
  "pi_wait",
  "Block until the agent finishes its current task (or timeout). Use after pi_prompt.",
  { timeout: z.number().optional().describe("Max wait time in ms (default 300000 = 5min)") },
  async ({ timeout }) => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await pi.waitForIdle(timeout ?? DEFAULT_TIMEOUT);
      return { content: [{ type: "text", text: "Agent is idle." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_result",
  "Get the agent's last text response.",
  {},
  async () => {
    const result = pi.getResult();
    return { content: [{ type: "text", text: result ?? "(no output yet)" }] };
  }
);

server.tool(
  "pi_state",
  "Get the agent's current state (model, streaming status, message count, etc.).",
  {},
  async () => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: JSON.stringify({ running: false }) }] };
    }
    try {
      const state = await pi.getState();
      return { content: [{ type: "text", text: JSON.stringify({ running: true, ...state }, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// -- Model tools --

server.tool(
  "pi_set_model",
  "Switch the agent to a different model mid-session.",
  {
    provider: z.string().describe("Provider name (e.g. 'ollama')"),
    model: z.string().describe("Model ID (e.g. 'gemma4', 'devstral')"),
  },
  async ({ provider, model }) => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      const result = await pi.setModel(provider, model);
      return { content: [{ type: "text", text: `Model set to ${JSON.stringify(result)}` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// -- Context tools --

server.tool(
  "pi_compact",
  "Compact the agent's context window (useful for long sessions).",
  { instructions: z.string().optional().describe("Custom compaction instructions") },
  async ({ instructions }) => {
    if (!pi.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      const result = await pi.compact(instructions);
      return { content: [{ type: "text", text: `Compacted. ${JSON.stringify(result)}` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("pi-bridge MCP server running (stdio)\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
