/**
 * Schema versioning tests: SQLite PRAGMA stamping, forward-only migration
 * runner behavior, and the JSONL config marker upgrade path.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteStorage } from "../src/storage.ts";
import { SCHEMA_VERSION, migrateSqlite, migrateJsonlConfigVersion } from "../src/schema.ts";
import { EventStore } from "../src/store.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "uba-schema-"));
}

/** Open a raw sqlite db to inspect what the storage backend stamped. */
function openRawDb(path: string): DatabaseSync {
  return new DatabaseSync(path);
}

test("sqlite backend stamps user_version to SCHEMA_VERSION on open", () => {
  const dir = tempDir();
  const storage = new SqliteStorage(dir, "stamped.sqlite");
  try {
    storage.init();
    const db = openRawDb(join(dir, "stamped.sqlite"));
    try {
      const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(row.user_version, SCHEMA_VERSION);
    } finally {
      db.close();
    }
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("migrateSqlite upgrades an old database and is a no-op when current", () => {
  const dir = tempDir();
  const dbPath = join(dir, "old.sqlite");
  try {
    // Simulate a dataset stamped at version 0 (pre-versioning database).
    const db = openRawDb(dbPath);
    db.exec("PRAGMA user_version = 0");
    const first = migrateSqlite(db);
    assert.equal(first.from, 0);
    assert.equal(first.to, SCHEMA_VERSION);
    const second = migrateSqlite(db);
    assert.equal(second.from, SCHEMA_VERSION);
    assert.equal(second.to, SCHEMA_VERSION, "re-running on a current db must not change anything");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("migrateJsonlConfigVersion upgrades missing or old markers", () => {
  assert.deepEqual(migrateJsonlConfigVersion(undefined), { from: 0, to: SCHEMA_VERSION });
  assert.deepEqual(migrateJsonlConfigVersion(0), { from: 0, to: SCHEMA_VERSION });
  assert.deepEqual(migrateJsonlConfigVersion(SCHEMA_VERSION), { from: SCHEMA_VERSION, to: SCHEMA_VERSION });
});

test("EventStore.init persists the upgraded schemaVersion marker in config", () => {
  const dir = tempDir();
  const store = new EventStore({ dataDir: dir, schemaVersion: 0 });
  try {
    store.init();
    const reopened = EventStore.loadFrom(dir);
    assert.equal(reopened.config.schemaVersion, SCHEMA_VERSION);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
