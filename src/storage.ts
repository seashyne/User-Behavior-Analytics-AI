/**
 * Storage layer: pluggable persistence behind one async interface.
 *
 * Every method returns a Promise. That contract is what makes remote SQL
 * backends (Postgres, MySQL, ClickHouse adapters) implementable without a
 * second API surface: local file backends resolve immediately, remote ones
 * await network I/O, and consumers cannot tell the difference.
 *
 * Two backends ship with the package, selected via config.storage.backend:
 * - "jsonl":  append-only text file (default). Zero requirements, human
 *   readable, trivial to back up or grep.
 * - "sqlite": single-file SQL database via Node's built-in node:sqlite
 *   module (Node >= 22.5). Indexed queries and transactional writes.
 *
 * readAll() accepts a time window (ReadRange). The SQLite backend pushes
 * the window into the query so the timestamp index limits what leaves the
 * database - the foundation for bounded-memory analysis of large datasets.
 *
 * The SQLite backend is loaded lazily so Node 20 users on the default JSONL
 * backend never touch the node:sqlite module.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { migrateSqlite } from "./schema.ts";
import type { ReadRange, UBAEvent } from "./types.ts";

// ESM-compatible require, used only for the lazy node:sqlite load below.
const nodeRequire = createRequire(import.meta.url);

/** Persistence contract implemented by every storage backend. */
export interface EventStorage {
  /** Prepare the underlying storage (create file/table). Idempotent. */
  init(): Promise<void>;
  /** Persist one already-complete event. */
  append(event: UBAEvent): Promise<void>;
  /** Persist many events; backends may batch for performance. */
  appendMany(events: UBAEvent[]): Promise<void>;
  /**
   * Return stored events ordered by timestamp ascending. When a range is
   * given, backends must filter at the source (SQL WHERE / index scan), not
   * load everything and filter afterwards.
   */
  readAll(range?: ReadRange): Promise<UBAEvent[]>;
  /** Remove all stored events but keep the storage itself usable. */
  clear(): Promise<void>;
  /**
   * Release underlying resources (open file handles). Required on Windows,
   * where an open SQLite database locks its file against deletion.
   */
  close(): Promise<void>;
}

/** Append-only JSON Lines file storage (the default backend). */
export class JsonlStorage implements EventStorage {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "events.jsonl");
  }

  async init(): Promise<void> {
    mkdirSync(join(this.path, ".."), { recursive: true });
    if (!existsSync(this.path)) writeFileSync(this.path, "", "utf8");
  }

  async append(event: UBAEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: UBAEvent[]): Promise<void> {
    if (events.length === 0) return;
    this.initSync();
    // One write for the whole batch instead of one per event.
    appendFileSync(this.path, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }

  async readAll(range?: ReadRange): Promise<UBAEvent[]> {
    if (!existsSync(this.path)) return [];
    const events: UBAEvent[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as UBAEvent;
        // Whole-file format: the window can only be applied after parsing.
        if (range?.since !== undefined && event.timestamp < range.since) continue;
        if (range?.until !== undefined && event.timestamp >= range.until) continue;
        events.push(event);
      } catch {
        // Skip corrupt lines: a partial write must not brick the dataset.
      }
    }
    events.sort((a, b) => a.timestamp - b.timestamp);
    return events;
  }

  async clear(): Promise<void> {
    if (existsSync(this.path)) writeFileSync(this.path, "", "utf8");
  }

  async close(): Promise<void> {
    // Nothing to release: the JSONL file is opened per write and never held.
  }

  private initSync(): void {
    mkdirSync(join(this.path, ".."), { recursive: true });
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

  /** Open (once) and ensure schema, indexes, and schema version exist. */
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
    // Stamp or upgrade the schema version (PRAGMA user_version). Runs on
    // every open; a current database is a no-op.
    migrateSqlite(db);
    this.db = db;
    return db;
  }

  async init(): Promise<void> {
    this.open();
  }

  async append(event: UBAEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: UBAEvent[]): Promise<void> {
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

  async readAll(range?: ReadRange): Promise<UBAEvent[]> {
    const db = this.open();
    // The window is pushed into the query so the timestamp index decides
    // what is read at all; JS never sees out-of-window rows.
    const conditions: string[] = [];
    const params: number[] = [];
    if (range?.since !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(range.since);
    }
    if (range?.until !== undefined) {
      conditions.push("timestamp < ?");
      params.push(range.until);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT id, user_id, event, timestamp, session_id, properties FROM events ${where} ORDER BY timestamp ASC`)
      .all(...params) as Array<{
      id: string;
      user_id: string;
      event: string;
      timestamp: number | bigint;
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

  async clear(): Promise<void> {
    this.open().exec("DELETE FROM events");
  }

  async close(): Promise<void> {
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
