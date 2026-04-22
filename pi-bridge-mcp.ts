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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, execSync, type ChildProcess } from "child_process";
import { writeFileSync, readFileSync, renameSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import { StringDecoder } from "string_decoder";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { openQueue, queueAdd, queueClaim, queueComplete, queueFail, queueCancel, queueGet, queueList, type QueueTask } from "./queue.js";

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
const PARALLEL_LIMIT = parseInt(process.env.PARALLEL_LIMIT ?? "1", 10);
const QUEUE_POLL_INTERVAL = parseInt(process.env.QUEUE_POLL_INTERVAL ?? "5000", 10);
const QUEUE_TASK_TIMEOUT = parseInt(process.env.QUEUE_TASK_TIMEOUT ?? "1800000", 10); // 30min default
const GLOBAL_SLOTS_DIR = "/tmp/pi-bridge-slots";
const PI_DEBUG = process.env.PI_DEBUG === "1";
const PI_DEBUG_DIR = process.env.PI_DEBUG_DIR ?? "/tmp/pi-bridge-logs";
const REMOTE_DELEGATION = process.env.REMOTE_DELEGATION === "1";
const BOARD_TASKS_DIR = process.env.BOARD_TASKS_DIR ?? join(process.cwd(), ".tasks");

function captureContainerLogs(containerName: string, label?: string): void {
  if (!PI_DEBUG) return;
  try {
    mkdirSync(PI_DEBUG_DIR, { recursive: true });
    const suffix = label ? `-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
    const logPath = `${PI_DEBUG_DIR}/${containerName}${suffix}-${Date.now()}.log`;
    execSync(`podman logs ${containerName} > ${logPath} 2>&1`);
    process.stderr.write(`[pi-bridge] debug log: ${logPath}\n`);
  } catch (e: any) {
    process.stderr.write(`[pi-bridge] failed to capture logs for ${containerName}: ${e.message}\n`);
  }
}

function acquireGlobalSlot(instanceId: string): boolean {
  try {
    // Sanitize instanceId: allow only alphanumeric, underscore, hyphen
    const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "_");
    mkdirSync(GLOBAL_SLOTS_DIR, { recursive: true });
    const files = readdirSync(GLOBAL_SLOTS_DIR);
    let live = 0;
    for (const f of files) {
      const pid = parseInt(f.split("-")[0]);
      if (!pid) continue;
      try { process.kill(pid, 0); live++; }
      catch { try { unlinkSync(join(GLOBAL_SLOTS_DIR, f)); } catch {} }
    }
    if (live >= PARALLEL_LIMIT) return false;
    writeFileSync(join(GLOBAL_SLOTS_DIR, `${process.pid}-${safeId}`), "");
    return true;
  } catch {
    return true; // fail open if slots dir inaccessible
  }
}

function releaseGlobalSlot(instanceId: string): void {
  try {
    const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "_");
    unlinkSync(join(GLOBAL_SLOTS_DIR, `${process.pid}-${safeId}`));
  } catch {}
}

// ---------------------------------------------------------------------------
// Repo name detection for worktree organization
// ---------------------------------------------------------------------------

function getRepoName(workspace: string): string {
  try {
    const remote = execSync(`git -C ${workspace} config --get remote.origin.url`, { encoding: "utf-8" }).trim();
    // Parse repo name from SSH (git@github.com:user/repo.git) or HTTPS (https://github.com/user/repo.git)
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match?.[1]) {
      return sanitizeRepoName(match[1]);
    }
  } catch {
    // Not a git repo or no remote configured
  }
  return sanitizeRepoName(basename(workspace));
}

function sanitizeRepoName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---------------------------------------------------------------------------
// Resource subscription tracking
// ---------------------------------------------------------------------------

/** Set of currently subscribed resource URIs */
const subscribedResources = new Set<string>();

/** Send a resource update notification only if the URI is subscribed. */
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

const LOG_RING_SIZE = 200;
const LOG_NOTIFICATION_INTERVAL = 500;

class PiRpcClient {
  private proc: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private events: any[] = [];
  private lastAssistantText: string | null = null;
  private _isStreaming = false;
  private _promptPending = false;
  private idlePromise: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private stopReading: (() => void) | null = null;
  containerName: string | null = null;
  private worktreePath: string | null = null;
  private worktreeWorkDir: string | null = null;
  private worktreeBranch: string | null = null;

  // Per-instance log state
  private logBuffer: string[] = [];
  private logTailProc: ChildProcess | null = null;
  private lastLogNotificationTs = 0;

  // Agent-end callback: fired when the agent finishes (or fails)
  onAgentEnd?: (error?: string) => void;

  // Called by pi_start to remove this instance from the map on exit
  onExit?: () => void;

  startLogTail(notify?: (params: { uri: string }) => void): void {
    this.stopLogTail();
    if (!this.containerName) return;
    this.logTailProc = spawn("podman", ["logs", "-f", this.containerName], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.logTailProc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.length > 0) {
          this.logBuffer.push(line);
          if (this.logBuffer.length > LOG_RING_SIZE) this.logBuffer.shift();
        }
      }
      if (notify) {
        const now = Date.now();
        if (now - this.lastLogNotificationTs >= LOG_NOTIFICATION_INTERVAL) {
          this.lastLogNotificationTs = now;
          notify({ uri: "pi://logs/current" });
        }
      }
    });
    this.logTailProc.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) process.stderr.write(`[pi-bridge log tail] ${msg}\n`);
    });
  }

  stopLogTail(): void {
    if (this.logTailProc) {
      this.logTailProc.kill("SIGTERM");
      this.logTailProc = null;
    }
    this.logBuffer.length = 0;
    this.lastLogNotificationTs = 0;
  }

  getRecentLogs(): string {
    return this.logBuffer.join("\n");
  }

  async start(contextDir?: string, taskFile?: string, editDir?: string, name?: string): Promise<void> {
    if (this.proc) return;

    this.containerName = name ?? `pi-agent-${Date.now()}`;

    // Auto-create a git worktree if contextDir is a git repo and no editDir was passed
    let worktreePath: string | undefined;
    if (contextDir && !editDir && (() => { try { execSync(`git -C ${contextDir} rev-parse --git-dir`, {stdio:"ignore"}); return true; } catch { return false; } })()) {
      try {
        const branch = `pi/${name}-${Date.now()}`;
        const repoName = getRepoName(contextDir);
        worktreePath = `/tmp/pi-worktrees/${repoName}/${branch.replace(/\//g, "-")}`;
        execSync(`mkdir -p /tmp/pi-worktrees/${repoName}`);
        execSync(`git -C ${contextDir} worktree add ${worktreePath} -b ${branch}`);
        this.worktreePath = worktreePath;
        this.worktreeWorkDir = contextDir;
        this.worktreeBranch = branch;
      } catch (e: any) {
        process.stderr.write(`[pi-bridge] worktree creation failed, no write mount: ${e.message}\n`);
      }
    }

    const mounts: string[] = [];
    // Only one repo mount active at a time
    if (worktreePath) {
      // Worktree active — single writeable mount, NO /context
      mounts.push("-v", `${worktreePath}:/workspace:rw`);
    } else if (editDir) {
      // Explicit editdir (deprecated)
      mounts.push("-v", `${editDir}:/workspace:rw`);
    } else if (contextDir) {
      // Read-only fallback
      mounts.push("-v", `${contextDir}:/context:ro`);
    }
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
      this.onExit?.();
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

  async startRemote(repoUrl: string, branch: string, taskFile?: string, name?: string, extraEnv: string[] = []): Promise<void> {
    if (this.proc) return;

    this.containerName = name ?? `pi-agent-${Date.now()}`;

    const mounts: string[] = [];
    if (taskFile) mounts.push("-v", `${taskFile}:/task.md:rw`);
    mounts.push("-v", `${OUTPUT_DIR}:/output`);

    // Credential mounts
    mounts.push("--secret", "gh-token");
    if (process.env.SSH_AUTH_SOCK) {
      mounts.push("-v", `${process.env.SSH_AUTH_SOCK}:/ssh-agent`);
    }

    const envVars = [
      "-e", `MEMORY_BACKEND=${process.env.MEMORY_BACKEND ?? "lance"}`,
      "-e", `REPO_URL=${repoUrl}`,
      "-e", `REPO_BRANCH=${branch}`,
      ...extraEnv,
    ];
    if (process.env.SSH_AUTH_SOCK) {
      envVars.push("-e", "SSH_AUTH_SOCK=/ssh-agent");
    }

    this.proc = spawn("podman", [
      "run", "--rm", "-i",
      "--name", this.containerName,
      ...mounts,
      ...envVars,
      "-v", `${LOCAL_AGENT_DIR}/pi-models.json:/root/.pi/agent/models.json:ro`,
      "-v", `${LOCAL_AGENT_DIR}/pi-settings.json:/root/.pi/agent/settings.json:ro`,
      "-v", `${LOCAL_AGENT_DIR}/lance-extension.ts:/ext/lance-extension.ts:ro`,
      "-v", `${LOCAL_AGENT_DIR}/membrain-extension.ts:/ext/membrain-extension.ts:ro`,
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
      this.onExit?.();
      for (const [, req] of this.pending) {
        req.reject(new Error(`pi process exited with code ${code}`));
      }
      this.pending.clear();
      if (this.idlePromise) {
        this.idlePromise.resolve();
        this.idlePromise = null;
      }
    });
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
    this.stopLogTail();
    this.stopReading?.();
    this.stopReading = null;

    // Worktree removal is the caller's responsibility — call pi_merge first, then pi_stop.
    // Never auto-remove worktree here; changes must be reviewed first.

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
// Instance registry
// ---------------------------------------------------------------------------

const instances = new Map<string, PiRpcClient>();

/** Return a specific instance by ID, or the last started instance if no ID given. */
function getInstance(instanceId?: string): PiRpcClient | null {
  if (instanceId) return instances.get(instanceId) ?? null;
  const vals = [...instances.values()];
  return vals[vals.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// State persistence (survives MCP server restarts)
// ---------------------------------------------------------------------------

interface InstanceState {
  instanceId: string;
  containerName: string;
  worktreePath: string | null;
  worktreeWorkDir: string | null;
  worktreeBranch: string | null;
}

interface SavedState {
  pid: number;
  instances: InstanceState[];
}

function saveState(): void {
  const state: SavedState = {
    pid: process.pid,
    instances: [...instances.entries()].map(([instanceId, client]) => {
      const wt = client.getWorktreeInfo();
      return {
        instanceId,
        containerName: client.containerName!,
        worktreePath: wt?.path ?? null,
        worktreeWorkDir: wt?.workDir ?? null,
        worktreeBranch: wt?.branch ?? null,
      };
    }).filter(s => s.containerName),
  };
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

function clearState(): void {
  try { unlinkSync(STATE_FILE); } catch {}
}


interface CleanupDeps {
  execSync?: typeof import("child_process").execSync;
  processKill?: typeof process.kill;
  readFileSync?: typeof import("fs").readFileSync;
  unlinkSync?: typeof import("fs").unlinkSync;
  stderrWrite?: typeof process.stderr.write;
  captureContainerLogs?: (containerName: string) => void;
}

export function cleanupStaleInstances(deps?: CleanupDeps): void {
  const exec = deps?.execSync ?? execSync;
  const procKill = deps?.processKill ?? process.kill.bind(process);
  const read = deps?.readFileSync ?? readFileSync;
  const unlk = deps?.unlinkSync ?? unlinkSync;
  const w = deps?.stderrWrite ?? process.stderr.write;
  const captureLogs = deps?.captureContainerLogs ?? captureContainerLogs;

  const myPid = process.pid;

  // Kill truly orphaned pi-bridge processes (ppid <= 1 = reparented to init, parent died)
  try {
    const out = exec(`pgrep -f 'pi-bridge-mcp.ts'`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const pids = out.split("\n").map(p => parseInt(p.trim())).filter(p => p && p !== myPid);
    let killed = 0;
    for (const pid of pids) {
      try {
        const ppid = parseInt(exec(`ps -o ppid= -p ${pid}`, { encoding: "utf-8" }).trim());
        if (ppid <= 1) {
          procKill(pid, "SIGTERM");
          killed++;
        }
      } catch {}
    }
    if (killed > 0) w(`[pi-bridge] Killed ${killed} orphaned MCP process(es)\n`);
  } catch {}

  // Clean up containers owned by dead instances via per-PID state files
  try {
    const files = exec(`ls /tmp/pi-bridge-state-*.json 2>/dev/null`, { encoding: "utf-8" })
      .trim().split("\n").filter(Boolean);
    for (const file of files) {
      try {
        const state: SavedState = JSON.parse(read(file, "utf-8"));
        try {
          procKill(state.pid, 0); // throws if process is dead
        } catch {
          // Process dead — clean up all its containers
          for (const inst of state.instances ?? []) {
            try { captureLogs(inst.containerName); } catch {}
            try { exec(`podman stop ${inst.containerName}`, { stdio: "ignore" }); } catch {}
            w(`[pi-bridge] Stopped orphaned container: ${inst.containerName}\n`);
          }
          unlk(file);
        }
      } catch {}
    }
  } catch {}
}


// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

cleanupStaleInstances();

const db = openQueue();

const server = new McpServer({
  name: "pi-bridge",
  version: "1.0.0",
});

// Enable subscription support — the high-level McpServer API doesn't expose this;
// use the low-level inner server to set the capability flag.
server.server.registerCapabilities({ resources: { subscribe: true } });

// Register the container-logs resource (last started instance)
server.resource("pi-logs", "pi://logs/current", async () => ({
  contents: [{ uri: "pi://logs/current", text: getInstance()?.getRecentLogs() ?? "" }],
}));

// Register the agent-status resource
server.resource("pi-status", "pi://agent/status", async () => ({
  contents: [{ uri: "pi://agent/status", text: JSON.stringify(
    [...instances.entries()].map(([id, client]) => ({
      instance_id: id,
      running: client.isRunning,
      streaming: client.isStreaming,
    }))
  )}],
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

// -- Lifecycle tools --

const INSTANCE_ID_PARAM = z.string().optional().describe("Instance ID from pi_start. Omit to target the last started instance.");


server.tool(
  "pi_start",
  `Start a pi agent instance. Returns an instance_id to use with other pi_ tools. Supports up to PARALLEL_LIMIT (currently ${PARALLEL_LIMIT}) concurrent agents. Mode: ${REMOTE_DELEGATION ? "REMOTE (container clones repo)" : "LOCAL (bind-mount workspace)"}.`,
  REMOTE_DELEGATION
    ? { repo_url: z.string(), repo_branch: z.string().optional(), task: z.string().optional() }
    : { workspace: z.string().optional(), task: z.string().optional(), editdir: z.string().optional() },
  async (args: any) => {
    try {
      if (REMOTE_DELEGATION) {
        // Remote mode: repo_url required, workspace/editdir not used
        const { repo_url, repo_branch, task } = args;
        if (!repo_url) {
          return { content: [{ type: "text", text: "repo_url is required in REMOTE_DELEGATION mode." }], isError: true };
        }

        const instanceId = `pi-remote-${Date.now()}`;

        if (!acquireGlobalSlot(instanceId)) {
          return { content: [{ type: "text", text: `At machine-wide parallel limit (${PARALLEL_LIMIT}). Stop an existing instance first, or increase PARALLEL_LIMIT env var.` }], isError: true };
        }

        const client = new PiRpcClient();
        instances.set(instanceId, client);

        client.onAgentEnd = (error) => {
          if (client.containerName) {
            const sentinel = `/tmp/${client.containerName}.status`;
            try { writeFileSync(sentinel, JSON.stringify({ done: true, error: error ?? null, ts: Date.now() })); } catch {}
          }
          saveState();
          sendResourceUpdated("pi://agent/status");
        };

        client.onExit = () => {
          instances.delete(instanceId);
          releaseGlobalSlot(instanceId);
          saveState();
        };

        // Build env vars for remote mode
        const branch = repo_branch ?? `pi/remote-${Date.now()}`;
        const envVars: string[] = [
          `-e`, `REPO_URL=${repo_url}`,
          `-e`, `REPO_BRANCH=${branch}`,
        ];

        await client.startRemote(repo_url, branch, task, instanceId, envVars);
        saveState();

        client.startLogTail(() => sendResourceUpdated("pi://logs/current"));
        sendResourceUpdated("pi://logs/current");

        const sentinel = `/tmp/${instanceId}.status`;
        return { content: [{ type: "text", text: `Pi agent starting as remote instance '${instanceId}'. Repo: ${repo_url}, branch: ${branch}\n\nNon-blocking completion: watch sentinel file '${sentinel}'.\nMonitor command: until [ -f ${sentinel} ]; do sleep 1; done && cat ${sentinel}` }] };
      }

      // Local mode
      const { workspace, task, editdir } = args;
      const taskSlug = task ? basename(task, ".md") : null;
      const workspaceBase = workspace ? basename(workspace) : null;
      const instanceId = `pi-${taskSlug ?? workspaceBase ?? Date.now()}`;

      if (!acquireGlobalSlot(instanceId)) {
        return { content: [{ type: "text", text: `At machine-wide parallel limit (${PARALLEL_LIMIT}). Stop an existing instance first, or increase PARALLEL_LIMIT env var.` }], isError: true };
      }

      const client = new PiRpcClient();

      // Reserve slot synchronously before any async work
      instances.set(instanceId, client);

      // Wire per-instance callbacks
      client.onAgentEnd = (error) => {
        if (client.containerName) {
          const sentinel = `/tmp/${client.containerName}.status`;
          try {
            writeFileSync(sentinel, JSON.stringify({ done: true, error: error ?? null, ts: Date.now() }));
          } catch {}
        }
        saveState();
        sendResourceUpdated("pi://agent/status");
      };

      client.onExit = () => {
        instances.delete(instanceId);
        releaseGlobalSlot(instanceId);
        saveState();
      };

      await client.start(workspace, task, editdir, instanceId);
      saveState();

      client.startLogTail(() => {
        sendResourceUpdated("pi://logs/current");
      });
      sendResourceUpdated("pi://logs/current");

      const sentinel = `/tmp/${instanceId}.status`;
      return { content: [{ type: "text", text: `Pi agent starting as instance '${instanceId}'. Pass instance_id="${instanceId}" to other pi_ tools to target this agent.\n\nUse pi_prompt or pi_prompt_and_wait — they wait for readiness automatically.\n\nNon-blocking completion: watch sentinel file '${sentinel}'.\nMonitor command: until [ -f ${sentinel} ]; do sleep 1; done && cat ${sentinel}` }] };

    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to start: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_stop",
  "Stop a pi agent instance and clean up its container. If a worktree was auto-created, call pi_merge first to preserve agent changes before stopping.",
  { instance_id: INSTANCE_ID_PARAM },
  async ({ instance_id }) => {
    const client = getInstance(instance_id);
    if (!client) {
      return { content: [{ type: "text", text: "No running pi agent found." }], isError: true };
    }
    const resolvedId = instance_id ?? [...instances.entries()].find(([, v]) => v === client)?.[0];
    const name = client.containerName;
    if (name) captureContainerLogs(name);
    await client.stop();
    if (resolvedId) {
      instances.delete(resolvedId);
      releaseGlobalSlot(resolvedId);
    }
    saveState();
    if (name) {
      try { unlinkSync(`/tmp/${name}.status`); } catch {}
    }
    return { content: [{ type: "text", text: `Pi agent '${resolvedId ?? name}' stopped.` }] };
  }
);

server.tool(
  "pi_list",
  "List all active pi agent instances with their status.",
  {},
  async () => {
    if (instances.size === 0) {
      return { content: [{ type: "text", text: "No active instances." }] };
    }
    const list = [...instances.entries()].map(([id, client]) => ({
      instance_id: id,
      container_name: client.containerName,
      running: client.isRunning,
      streaming: client.isStreaming,
    }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

server.tool(
  "pi_merge",
  "Commit any uncommitted agent edits in the worktree, merge the worktree branch back into the base repo, then remove the worktree. Call this after pi_wait/pi_result and before pi_stop.",
  {
    instance_id: INSTANCE_ID_PARAM,
    commit_message: z.string().optional().describe("Commit message for uncommitted worktree changes (default: auto-generated)"),
    keep_branch: z.boolean().optional().describe("Keep the worktree branch after merge (default: false — branch is deleted)"),
  },
  async ({ instance_id, commit_message, keep_branch }) => {
    const client = getInstance(instance_id);
    if (!client) {
      return { content: [{ type: "text", text: "No running pi agent found." }], isError: true };
    }
    const info = client.getWorktreeInfo();
    if (!info) {
      return { content: [{ type: "text", text: "No active worktree. Nothing to merge." }] };
    }
    const result = client.mergeWorktree(commit_message, !keep_branch);
    return { content: [{ type: "text", text: result }] };
  }
);

// -- Task tools --

server.tool(
  "pi_prompt",
  "Send a task/prompt to the pi agent. The agent starts working asynchronously. Use pi_wait to block until done, then pi_result to get the output.",
  {
    message: z.string().describe("The task or prompt to send to the agent"),
    instance_id: INSTANCE_ID_PARAM,
  },
  async ({ message, instance_id }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running. Call pi_start first." }], isError: true };
    }
    try {
      await client.ensureReady();
      await client.prompt(message);
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
    instance_id: INSTANCE_ID_PARAM,
    timeout: z.number().optional().describe("Max wait time in ms (default 300000 = 5min)"),
  },
  async ({ message, instance_id, timeout }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running. Call pi_start first." }], isError: true };
    }
    try {
      await client.ensureReady();
      await client.prompt(message);
      await client.waitForIdle(timeout ?? DEFAULT_TIMEOUT);
      const result = client.getResult();
      return { content: [{ type: "text", text: result ?? "(no output)" }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_steer",
  "Send a steering message to redirect the agent mid-task. Delivered after current tool calls finish, before the next LLM call.",
  {
    message: z.string().describe("Steering instruction"),
    instance_id: INSTANCE_ID_PARAM,
  },
  async ({ message, instance_id }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await client.steer(message);
      return { content: [{ type: "text", text: "Steering message queued." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_follow_up",
  "Queue a follow-up message to be processed after the agent finishes its current task.",
  {
    message: z.string().describe("Follow-up instruction"),
    instance_id: INSTANCE_ID_PARAM,
  },
  async ({ message, instance_id }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await client.followUp(message);
      return { content: [{ type: "text", text: "Follow-up queued." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_abort",
  "Abort the agent's current operation immediately.",
  { instance_id: INSTANCE_ID_PARAM },
  async ({ instance_id }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await client.abort();
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
  {
    instance_id: INSTANCE_ID_PARAM,
    timeout: z.number().optional().describe("Max wait time in ms (default 300000 = 5min)"),
  },
  async ({ instance_id, timeout }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      await client.waitForIdle(timeout ?? DEFAULT_TIMEOUT);
      return { content: [{ type: "text", text: "Agent is idle." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "pi_result",
  "Get the agent's last text response.",
  { instance_id: INSTANCE_ID_PARAM },
  async ({ instance_id }) => {
    const client = getInstance(instance_id);
    const result = client?.getResult();
    return { content: [{ type: "text", text: result ?? "(no output yet)" }] };
  }
);

server.tool(
  "pi_state",
  "Get the agent's current state (model, streaming status, message count, etc.).",
  { instance_id: INSTANCE_ID_PARAM },
  async ({ instance_id }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: JSON.stringify({ running: false }) }] };
    }
    try {
      const state = await client.getState();
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
    instance_id: INSTANCE_ID_PARAM,
  },
  async ({ provider, model, instance_id }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      const result = await client.setModel(provider, model);
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
  {
    instance_id: INSTANCE_ID_PARAM,
    instructions: z.string().optional().describe("Custom compaction instructions"),
  },
  async ({ instance_id, instructions }) => {
    const client = getInstance(instance_id);
    if (!client?.isRunning) {
      return { content: [{ type: "text", text: "Pi agent not running." }], isError: true };
    }
    try {
      const result = await client.compact(instructions);
      return { content: [{ type: "text", text: `Compacted. ${JSON.stringify(result)}` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Queue MCP tools
// ---------------------------------------------------------------------------

server.tool(
  "queue_add",
  "Add a task to the delegation queue. The worker loop will pick it up and run it with a local pi agent. Returns a task ID you can use with queue_status.",
  {
    prompt: z.string().describe("The task or prompt for the agent to complete"),
    workspace: z.string().optional().describe("Host repo directory to mount as context"),
    task_file: z.string().optional().describe("Host path to a task .md file to mount as /task.md"),
    task_slug: z.string().optional().describe("Short slug for the task (used in instance naming)"),
  },
  async ({ prompt, workspace, task_file, task_slug }) => {
    const task = queueAdd(db, { prompt, workspace, taskFile: task_file, taskSlug: task_slug });
    return { content: [{ type: "text", text: `Task queued. ID: ${task.id}\nStatus: queued\nMonitor: queue_status id="${task.id}"` }] };
  }
);

server.tool(
  "queue_list",
  "List all tasks in the delegation queue, optionally filtered by status.",
  {
    status: z.enum(["queued", "processing", "done", "failed"]).optional().describe("Filter by status"),
  },
  async ({ status }) => {
    const tasks = queueList(db, status);
    if (tasks.length === 0) return { content: [{ type: "text", text: "No tasks." }] };
    return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
  }
);

server.tool(
  "queue_status",
  "Get the status and result of a specific queued task.",
  { id: z.string().describe("Task ID from queue_add") },
  async ({ id }) => {
    const task = queueGet(db, id);
    if (!task) return { content: [{ type: "text", text: `Task ${id} not found.` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  "queue_cancel",
  "Cancel a queued task (only works if status is 'queued' — cannot cancel in-progress tasks).",
  { id: z.string().describe("Task ID to cancel") },
  async ({ id }) => {
    const cancelled = queueCancel(db, id);
    if (!cancelled) {
      const task = queueGet(db, id);
      if (!task) return { content: [{ type: "text", text: `Task ${id} not found.` }], isError: true };
      return { content: [{ type: "text", text: `Cannot cancel task in status '${task.status}'.` }], isError: true };
    }
    return { content: [{ type: "text", text: `Task ${id} cancelled.` }] };
  }
);

// ---------------------------------------------------------------------------
// Board-tui MCP client wrappers

interface BoardTuiDelegatedTask {
  slug: string;
  body?: string;
  column?: string;
  [key: string]: unknown;
}

/**
 * Spawn a board-tui MCP client connected to the board-tui-mcp subprocess.
 * @param repoDir - Optional repo directory (passed as BOARD_TASKS_DIR env var)
 * @returns Connected Client instance
 */
export async function spawnBoardTuiClient(repoDir?: string): Promise<Client> {
  const client = new Client({ name: "pi-bridge-board-tui", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "board-tui-mcp",
    env: { ...getDefaultEnvironment(), ...(repoDir ? { BOARD_TASKS_DIR: repoDir } : {}) },
  });
  await client.connect(transport);
  process.stderr.write("[pi-bridge] board-tui: connected to board-tui-mcp\n");
  return client;
}

/**
 * Call board-tui list_delegated_tasks MCP tool.
 * @param repoDir - Optional repo directory
 * @param status - Status filter (e.g., 'queued', 'done')
 * @returns Array of delegated tasks
 */
export async function listDelegatedTasks(repoDir?: string, status?: string): Promise<BoardTuiDelegatedTask[]> {
  const client = await spawnBoardTuiClient(repoDir);
  try {
    const result = await client.callTool({
      name: "list_delegated_tasks",
      arguments: { status: status ?? "queued" },
    });
    const taskText = result.content?.[0]?.type === "text" ? result.content[0].text : "[]";
    let tasks: BoardTuiDelegatedTask[] = [];
    try { tasks = JSON.parse(taskText); } catch { /* empty */ }
    return tasks;
  } finally {
    await client.close();
  }
}

/**
 * Call board-tui set_frontmatter MCP tool.
 * @param repoDir - Optional repo directory
 * @param slug - Task card slug
 * @param key - Frontmatter key
 * @param value - Frontmatter value
 */
export async function setFrontmatter(repoDir: string, slug: string, key: string, value: string): Promise<void> {
  const client = await spawnBoardTuiClient(repoDir);
  try {
    await client.callTool({
      name: "set_frontmatter",
      arguments: { slug, key, value },
    });
  } finally {
    await client.close();
  }
}

// Board-tui delegation scanner
// ---------------------------------------------------------------------------

/**
 * Scans board-tui for queued delegation tasks and enqueues them into the
 * local-agent queue. Called every QUEUE_POLL_INTERVAL from the worker loop.
 *
 * 1. Spawns board-tui MCP client via stdio
 * 2. Calls list_delegated_tasks("queued")
 * 3. For each task: queueAdd(), set_frontmatter(slug, "delegation_status", "processing")
 * 4. Closes MCP client
 */
export async function scanReposForDelegation(queueDb: ReturnType<typeof openQueue> = db, repoDir?: string): Promise<void> {
  const tasksDir = repoDir ?? BOARD_TASKS_DIR;
  const client = new Client({ name: "pi-bridge-scanner", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "board-tui-mcp",
    env: { ...getDefaultEnvironment(), BOARD_TASKS_DIR: tasksDir },
  });

  try {
    await client.connect(transport);
    process.stderr.write("[pi-bridge] scanner: connected to board-tui-mcp\n");

    // ---- Handle cancelled tasks first ----
    const cancelledResult = await client.callTool({
      name: "list_delegated_tasks",
      arguments: { status: "cancelled" },
    });
    const cancelledText = cancelledResult.content?.[0]?.type === "text" ? cancelledResult.content[0].text : "[]";
    let cancelledTasks: Array<{ slug: string }> = [];
    try { cancelledTasks = JSON.parse(cancelledText); } catch { /* empty */ }

    if (cancelledTasks.length > 0) {
      process.stderr.write(`[pi-bridge] scanner: found ${cancelledTasks.length} cancelled task(s)\n`);
      const queuedTasks = queueList(queueDb, "queued");
      for (const ct of cancelledTasks) {
        const match = queuedTasks.find(q => q.taskSlug === ct.slug);
        if (match) {
          queueCancel(queueDb, match.id);
          process.stderr.write(`[pi-bridge] scanner: cancelled queued task ${ct.slug} (id ${match.id})\n`);
        }
        // Clear delegation_status frontmatter regardless of queue state
        try {
          await client.callTool({
            name: "set_frontmatter",
            arguments: { slug: ct.slug, key: "delegation_status", value: "" },
          });
          process.stderr.write(`[pi-bridge] scanner: cleared delegation_status for ${ct.slug}\n`);
        } catch (e: any) {
          process.stderr.write(`[pi-bridge] scanner: failed to clear frontmatter for ${ct.slug}: ${e.message}\n`);
        }
      }
    }

    // Call list_delegated_tasks("queued") to find queued delegation tasks
    const result = await client.callTool({
      name: "list_delegated_tasks",
      arguments: { status: "queued" },
    });

    const taskText = result.content?.[0]?.type === "text" ? result.content[0].text : "[]";
    let tasks: Array<{ slug: string; body?: string }> = [];
    try {
      tasks = JSON.parse(taskText);
    } catch { /* empty results */ }

    if (tasks.length === 0) {
      process.stderr.write("[pi-bridge] scanner: no queued tasks found\n");
      return;
    }

    process.stderr.write(`[pi-bridge] scanner: found ${tasks.length} queued task(s)\n`);

    for (const task of tasks) {
      // Skip if already enqueued (same slug exists in queue)
      const existingSlugs = queueList(queueDb).map(t => t.taskSlug).filter(Boolean) as string[];
      if (existingSlugs.includes(task.slug)) {
        process.stderr.write(`[pi-bridge] scanner: skipping already-enqueued task: ${task.slug}\n`);
        continue;
      }

      // Build prompt from task body (strip frontmatter if present)
      let prompt: string | undefined;
      if (task.body) {
        const fmMatch = task.body.match(/^(---\n[\\s\\S]*?\n---)\\s*([\\s\\S]*)$/);
        prompt = fmMatch ? fmMatch[2]?.trim() ?? task.body : task.body;
      }

      // Enqueue the task
      queueAdd(queueDb, {
        prompt: prompt ?? `Process delegation task: ${task.slug}`,
        workspace: undefined,
        taskFile: undefined,
        taskSlug: task.slug,
      });

      // Update frontmatter: set delegation_status to processing
      try {
        await client.callTool({
          name: "set_frontmatter",
          arguments: { slug: task.slug, key: "delegation_status", value: "processing" },
        });
        process.stderr.write(`[pi-bridge] scanner: enqueued task ${task.slug} → processing\n`);
      } catch (e: any) {
        process.stderr.write(`[pi-bridge] scanner: failed to set frontmatter for ${task.slug}: ${e.message}\n`);
      }
    }

  } catch (e: any) {
    process.stderr.write(`[pi-bridge] scanner: error — ${e.message}\n`);
  } finally {
    await transport.close();
    process.stderr.write("[pi-bridge] scanner: board-tui-mcp client closed\n");
  }
}

/**
 * Sync delegation status back to the originating task card via board-tui MCP.
 * Updates frontmatter and appends result to the ## Result section.
 */
export async function syncTaskCard(
  repoDir: string,
  slug: string,
  status: string,
  resultText?: string,
): Promise<void> {
  const client = await spawnBoardTuiClient(repoDir);
  try {
    // Update frontmatter status
    await client.callTool({
      name: "set_frontmatter",
      arguments: { slug, key: "delegation_status", value: status },
    });

    // Append result to body if provided
    if (resultText) {
      const getResult = await client.callTool({
        name: "get_task",
        arguments: { slug },
      });
      const taskData = getResult.content?.[0]?.type === "text"
        ? JSON.parse(getResult.content[0].text)
        : null;
      const body: string = taskData?.body ?? "";

      let newBody: string;
      if (body.includes("## Result")) {
        newBody = body + `\n\n**${status.toUpperCase()}** @ ${new Date().toISOString()}\n\n${resultText}\n`;
      } else {
        newBody = body + `\n\n## Result\n\n**${status.toUpperCase()}** @ ${new Date().toISOString()}\n\n${resultText}\n`;
      }

      await client.callTool({
        name: "update_task",
        arguments: { slug, body: newBody },
      });
    }
  } finally {
    await client.close();
  }
}

/**
 * Process a single queue task: start pi agent, run prompt, update queue and card.
 */
export async function processQueueTask(task: QueueTask, piClient?: PiRpcClient, queueDb: ReturnType<typeof openQueue> = db, repoDir?: string): Promise<void> {
  const instanceId = `queue-${task.id.slice(0, 8)}`;
  const client = piClient ?? new PiRpcClient();
  const cardDir = repoDir ?? BOARD_TASKS_DIR;

  try {
    const workspace = task.workspace ?? LOCAL_AGENT_DIR;
    await client.start(workspace, task.taskFile ?? undefined, undefined, instanceId);
    await client.ensureReady();
    await client.prompt(task.prompt);
    await client.waitForIdle(QUEUE_TASK_TIMEOUT);
    const result = client.getResult();

    queueComplete(queueDb, task.id, result ?? "");
    if (task.taskSlug) {
      await syncTaskCard(cardDir, task.taskSlug, "done", result ?? undefined).catch(() => {});
    }
  } catch (e: any) {
    queueFail(queueDb, task.id, e.message);
    if (task.taskSlug) {
      await syncTaskCard(cardDir, task.taskSlug, "failed", e.message).catch(() => {});
    }
  } finally {
    await client.stop();
    releaseGlobalSlot(instanceId);
  }
}

async function workerTick(): Promise<void> {
  // Scan board-tui task dir for queued delegation tasks (non-blocking)
  scanReposForDelegation(db).catch(() => {});

  // Cheap local check first — avoids touching the slot dir every 5s when busy
  if (instances.size >= PARALLEL_LIMIT) return;

  const task = queueClaim(db, `worker-${process.pid}`);
  if (!task) return;

  const instanceId = `queue-${task.id.slice(0, 8)}`;

  // Acquire machine-wide slot; if at limit, put task back and bail
  if (!acquireGlobalSlot(instanceId)) {
    // Re-queue: reset status back to queued so another worker can pick it up
    try {
      db.prepare(`UPDATE tasks SET status='queued', agent_id=NULL, started_at=NULL WHERE id=?`).run(task.id);
    } catch {}
    return;
  }

  processQueueTask(task).catch(() => {});
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("pi-bridge MCP server running (stdio)\n");
  setInterval(() => { workerTick().catch(() => {}); }, QUEUE_POLL_INTERVAL);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
