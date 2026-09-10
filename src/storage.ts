/**
 * Storage layer: pluggable persistence behind one interface.
 *
 * Two backends ship with the package, selected via config.storage.backend:
 * - "jsonl":  append-only text file (default). Zero requirements, human
 *   readable, trivial to back up or grep.
 * - "sqlite": single-file SQL database via Node's built-in node:sqlite
 *   module (Node >= 22.5). Still zero external dependencies, but gives
 *   indexed queries and transactional writes for larger datasets.
 *
 * The SQLite backend is loaded lazily so Node 20 users on the default JSONL
 * backend never touch the node:sqlite module.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { UBAEvent } from "./types.ts";

// ESM-compatible require, used only for the lazy node:sqlite load below.
const nodeRequire = createRequire(import.meta.url);

/** Persistence contract implemented by every storage backend. */
export interface EventStorage {
  /** Prepare the underlying storage (create file/table). Idempotent. */
  init(): void;
  /** Persist one already-complete event. */
  append(event: UBAEvent): void;
  /** Persist many events; backends may batch for performance. */
  appendMany(events: UBAEvent[]): void;
  /** Return all stored events ordered by timestamp ascending. */
  readAll(): UBAEvent[];
  /** Remove all stored events but keep the storage itself usable. */
  clear(): void;
  /**
   * Release underlying resources (open file handles). Required on Windows,
   * where an open SQLite database locks its file against deletion.
   */
  close(): void;
}

/** Append-only JSON Lines file storage (the v0.1 default behavior). */
export class JsonlStorage implements EventStorage {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "events.jsonl");
  }

  init(): void {
    mkdirSync(join(this.path, ".."), { recursive: true });
    if (!existsSync(this.path)) writeFileSync(this.path, "", "utf8");
  }

  append(event: UBAEvent): void {
    this.init();
    appendFileSync(this.path, JSON.stringify(event) + "\n", "utf8");
  }

  appendMany(events: UBAEvent[]): void {
    if (events.length === 0) return;
    this.init();
    // One write for the whole batch instead of one per event.
    appendFileSync(this.path, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }

  readAll(): UBAEvent[] {
    if (!existsSync(this.path)) return [];
    const events: UBAEvent[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as UBAEvent);
      } catch {
        // Skip corrupt lines: a partial write must not brick the dataset.
      }
    }
    events.sort((a, b) => a.timestamp - b.timestamp);
    return events;
  }

  clear(): void {
    if (existsSync(this.path)) writeFileSync(this.path, "", "utf8");
  }

  close(): void {
    // Nothing to release: the JSONL file is opened per write and never held.
  }
}

/**
 * SQLite storage backed by node:sqlite (Node >= 22.5, built into Node).
 * Events live in one indexed table; properties are stored as a JSON text
 * column so any payload shape round-trips without schema changes.
 */
export class SqliteStorage implements EventStorage {
  private readonly path: string;
  private db: import("node:sqlite").DatabaseSync | null = null;

  constructor(dataDir: string, sqliteFile: string) {
    this.path = join(dataDir, sqliteFile);
  }

  /** Open (once) and ensure schema + indexes exist. */
  private open(): import("node:sqlite").DatabaseSync {
    if (this.db) return this.db;
    mkdirSync(join(this.path, ".."), { recursive: true });
    // node:sqlite is loaded lazily so JSONL-only users never need Node 22.5.
    let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
    try {
      ({ DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite"));
    } catch {
      throw new Error('The "sqlite" storage backend requires Node.js >= 22.5 (built-in node:sqlite). Upgrade Node or keep the default "jsonl" backend.');
    }
    const db = new DatabaseSync(this.path);
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT,
        properties TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
      CREATE INDEX IF NOT EXISTS idx_events_name ON events(event);
    `);
    this.db = db;
    return db;
  }

  init(): void {
    this.open();
  }

  append(event: UBAEvent): void {
    this.appendMany([event]);
  }

  appendMany(events: UBAEvent[]): void {
    if (events.length === 0) return;
    const db = this.open();
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO events (id, user_id, event, timestamp, session_id, properties) VALUES (?, ?, ?, ?, ?, ?)",
    );
    // A single transaction keeps bulk imports (demo, uba import) fast.
    db.exec("BEGIN");
    try {
      for (const e of events) {
        stmt.run(e.id, e.userId, e.event, e.timestamp, e.sessionId ?? null, e.properties ? JSON.stringify(e.properties) : null);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  readAll(): UBAEvent[] {
    const db = this.open();
    const rows = db.prepare("SELECT id, user_id, event, timestamp, session_id, properties FROM events ORDER BY timestamp ASC").all() as Array<{
      id: string;
      user_id: string;
      event: string;
      timestamp: number;
      session_id: string | null;
      properties: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      event: row.event,
      timestamp: Number(row.timestamp),
      ...(row.session_id ? { sessionId: row.session_id } : {}),
      ...(row.properties ? { properties: JSON.parse(row.properties) as Record<string, unknown> } : {}),
    }));
  }

  clear(): void {
    this.open().exec("DELETE FROM events");
  }

  close(): void {
    // Release the database file handle; on Windows an open handle locks the
    // file and would block deletion (e.g. rmSync in tests or uba clear).
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/** Factory: pick the backend implementation from resolved config. */
export function createStorage(dataDir: string, backend: "jsonl" | "sqlite", sqliteFile: string): EventStorage {
  return backend === "sqlite" ? new SqliteStorage(dataDir, sqliteFile) : new JsonlStorage(dataDir);
}
