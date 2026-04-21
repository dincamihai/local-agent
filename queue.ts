import Database from "better-sqlite3";
import { randomUUID } from "crypto";

export const QUEUE_FILE = process.env.QUEUE_FILE ?? "/tmp/pi-bridge-queue.db";

export interface QueueTask {
  id: string;
  taskSlug: string | null;
  workspace: string | null;
  taskFile: string | null;
  prompt: string;
  status: "queued" | "processing" | "done" | "failed";
  agentId: string | null;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  result: string | null;
  error: string | null;
  retryCount: number;
}

export function openQueue(): Database.Database {
  const db = new Database(QUEUE_FILE);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task_slug TEXT,
      workspace TEXT,
      task_file TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      agent_id TEXT,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      result TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

function rowToTask(row: any): QueueTask {
  return {
    id: row.id,
    taskSlug: row.task_slug,
    workspace: row.workspace,
    taskFile: row.task_file,
    prompt: row.prompt,
    status: row.status,
    agentId: row.agent_id,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    result: row.result,
    error: row.error,
    retryCount: row.retry_count,
  };
}

export function queueAdd(
  db: Database.Database,
  params: { taskSlug?: string; workspace?: string; taskFile?: string; prompt: string },
): QueueTask {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO tasks (id, task_slug, workspace, task_file, prompt, queued_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, params.taskSlug ?? null, params.workspace ?? null, params.taskFile ?? null, params.prompt, now);
  return queueGet(db, id)!;
}

export function queueClaim(db: Database.Database, agentId: string): QueueTask | null {
  const row = db.prepare(`
    UPDATE tasks SET status='processing', agent_id=?, started_at=?
    WHERE id = (SELECT id FROM tasks WHERE status='queued' ORDER BY queued_at LIMIT 1)
    RETURNING *
  `).get(agentId, Date.now()) as any;
  return row ? rowToTask(row) : null;
}

export function queueComplete(db: Database.Database, id: string, result: string): void {
  db.prepare(`
    UPDATE tasks SET status='done', result=?, completed_at=? WHERE id=?
  `).run(result, Date.now(), id);
}

export function queueFail(db: Database.Database, id: string, error: string): void {
  db.prepare(`
    UPDATE tasks SET status='failed', error=?, completed_at=?, retry_count=retry_count+1 WHERE id=?
  `).run(error, Date.now(), id);
}

export function queueCancel(db: Database.Database, id: string): boolean {
  const info = db.prepare(`
    DELETE FROM tasks WHERE id=? AND status='queued'
  `).run(id);
  return info.changes > 0;
}

export function queueGet(db: Database.Database, id: string): QueueTask | null {
  const row = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(id) as any;
  return row ? rowToTask(row) : null;
}

export function queueList(db: Database.Database, status?: string): QueueTask[] {
  const rows = status
    ? db.prepare(`SELECT * FROM tasks WHERE status=? ORDER BY queued_at ASC`).all(status) as any[]
    : db.prepare(`SELECT * FROM tasks ORDER BY queued_at ASC`).all() as any[];
  return rows.map(rowToTask);
}
