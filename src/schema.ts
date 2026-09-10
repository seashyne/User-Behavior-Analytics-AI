/**
 * Data schema versioning and forward-only migrations.
 *
 * Every persisted dataset carries a schema version:
 * - SQLite: the built-in PRAGMA user_version on the database file.
 * - JSONL:  the schemaVersion field inside uba.config.json.
 *
 * Migrations are forward-only and append-only, following the project
 * database rule: never edit an applied migration, always add a new one.
 * The runner applies every migration with toVersion greater than the
 * dataset's current version, in order, then stamps the new version.
 */
import type { DatabaseSync } from "node:sqlite";

/** Current schema version understood by this build of uba-ai. */
export const SCHEMA_VERSION = 1;

/** One forward migration step for the SQLite backend. */
export interface SqliteMigration {
  /** Schema version the dataset reaches after this migration runs. */
  toVersion: number;
  /** DDL/DML to apply. Runs inside a single transaction managed by the runner. */
  up(db: DatabaseSync): void;
}

/**
 * Registered SQLite migrations, oldest first.
 * Version 1 is the baseline schema created by SqliteStorage.open() itself
 * (CREATE TABLE IF NOT EXISTS is idempotent), so the list starts empty;
 * future releases append { toVersion: 2, up(db) {...} } and bump
 * SCHEMA_VERSION - never modify an entry that already shipped.
 */
export const SQLITE_MIGRATIONS: SqliteMigration[] = [];

/**
 * Bring a SQLite database from its stamped version up to SCHEMA_VERSION.
 * Safe to call on every open: a current database is a no-op, and each
 * migration plus the version stamp run inside one transaction so a crash
 * mid-upgrade cannot leave a half-migrated dataset.
 */
export function migrateSqlite(db: DatabaseSync): { from: number; to: number } {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number | bigint } | undefined;
  const from = Number(row?.user_version ?? 0);
  if (from >= SCHEMA_VERSION) return { from, to: from };

  const pending = SQLITE_MIGRATIONS.filter((m) => m.toVersion > from && m.toVersion <= SCHEMA_VERSION).sort(
    (a, b) => a.toVersion - b.toVersion,
  );

  db.exec("BEGIN");
  try {
    for (const migration of pending) migration.up(db);
    // PRAGMA user_version takes a literal, not a bind parameter; the value is
    // the internal SCHEMA_VERSION constant so injection is not a concern.
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { from, to: SCHEMA_VERSION };
}

/**
 * JSONL datasets have no in-file schema stamp, so the marker lives in
 * uba.config.json (schemaVersion). Missing/older markers are treated as
 * version 0 and upgraded to the current version here; the config writer in
 * EventStore.init persists the result. No data rewrites are needed yet -
 * when a future format change arrives, add its transform to this function.
 */
export function migrateJsonlConfigVersion(current: number | undefined): { from: number; to: number } {
  const from = typeof current === "number" ? current : 0;
  return { from, to: Math.max(from, SCHEMA_VERSION) };
}
