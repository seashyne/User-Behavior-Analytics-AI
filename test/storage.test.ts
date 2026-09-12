/**
 * Storage backend and config tests: JSONL/SQLite round-trip equivalence,
 * backend selection, sectioned config merging, and time-windowed reads.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store.ts";
import { JsonlStorage, SqliteStorage, createStorage } from "../src/storage.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.ts";
import type { UBAEvent } from "../src/types.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "uba-storage-"));
}

const sampleEvents: Array<{ userId: string; event: string; timestamp: number; properties?: Record<string, unknown> }> = [
  { userId: "u1", event: "page_view", timestamp: 1000, properties: { page: "/home" } },
  { userId: "u1", event: "signup", timestamp: 2000 },
  { userId: "u2", event: "content_view", timestamp: 1500, properties: { contentType: "image", contentId: "img-1", dwellMs: 4200 } },
];

test("sqlite backend round-trips events identically to jsonl", async () => {
  const dir = tempDir();
  const jsonl = new JsonlStorage(dir);
  const sqlite = new SqliteStorage(dir, "test.sqlite");
  try {
    for (const storage of [jsonl, sqlite]) {
      await storage.init();
      await storage.appendMany(sampleEvents.map((e, i) => ({ id: `id-${i}`, ...e })) as UBAEvent[]);
    }
    const fromJsonl = await jsonl.readAll();
    const fromSqlite = await sqlite.readAll();
    assert.equal(fromSqlite.length, 3);
    // Both backends return events ordered by timestamp (1000, 1500, 2000).
    assert.deepEqual(fromSqlite.map((e) => e.id), fromJsonl.map((e) => e.id));
    assert.deepEqual(fromSqlite[0]!.properties, { page: "/home" });
    assert.equal(fromSqlite[0]!.userId, "u1");
    // Properties survive the JSON text column round-trip.
    const cv = fromSqlite.find((e) => e.event === "content_view")!;
    assert.equal(cv.properties?.["contentId"], "img-1");
    assert.equal(cv.properties?.["dwellMs"], 4200);
    // Session id column round-trips as absent when never set.
    assert.equal("sessionId" in fromSqlite[0]!, false);

    await sqlite.clear();
    assert.equal((await sqlite.readAll()).length, 0);
    assert.ok(existsSync(join(dir, "test.sqlite")), "sqlite file should exist");
  } finally {
    // Always close before cleanup: an open handle locks the file on Windows.
    await sqlite.close();
    await jsonl.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("readAll honors since/until windows in both backends", async () => {
  const dir = tempDir();
  const jsonl = new JsonlStorage(join(dir, "jsonl"));
  const sqlite = new SqliteStorage(join(dir, "sql"), "win.sqlite");
  try {
    for (const storage of [jsonl, sqlite]) {
      await storage.init();
      await storage.appendMany([1000, 2000, 3000, 4000].map((t, i) => ({ id: `w-${t}`, userId: "u1", event: "tick", timestamp: t + i * 0 })) as UBAEvent[]);
    }
    for (const storage of [jsonl, sqlite]) {
      // Inclusive since, exclusive until - consistent across backends.
      const mid = await storage.readAll({ since: 1500, until: 4000 });
      assert.deepEqual(mid.map((e) => e.timestamp), [2000, 3000], `${storage.constructor.name} window`);
      const sinceOnly = await storage.readAll({ since: 3000 });
      assert.deepEqual(sinceOnly.map((e) => e.timestamp), [3000, 4000]);
      const untilOnly = await storage.readAll({ until: 2000 });
      assert.deepEqual(untilOnly.map((e) => e.timestamp), [1000]);
    }
  } finally {
    await sqlite.close();
    await jsonl.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("EventStore selects backend from config and persists it", async () => {
  const dir = tempDir();
  const store = new EventStore({ dataDir: dir, storage: { backend: "sqlite", sqliteFile: "uba.sqlite" } });
  try {
    await store.init();
    await store.trackBatch(sampleEvents);
    assert.equal((await store.readAll()).length, 3);
    assert.ok(existsSync(join(dir, "uba.sqlite")));
    assert.ok(!existsSync(join(dir, "events.jsonl")), "jsonl file should not be created for sqlite backend");

    // Reopening from the data dir must pick sqlite again via saved config.
    const loaded = EventStore.loadFrom(dir);
    assert.equal(loaded.config.storage.backend, "sqlite");
    assert.equal((await loaded.readAll()).length, 3);
    await loaded.close();
  } finally {
    // Close handles before cleanup (Windows file locking).
    await store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("resolveConfig deep-merges sections over defaults", () => {
  const resolved = resolveConfig({ storage: { backend: "sqlite" } as Partial<typeof DEFAULT_CONFIG.storage> });
  assert.equal(resolved.storage.backend, "sqlite");
  // sqliteFile keeps its default when only backend is overridden.
  assert.equal(resolved.storage.sqliteFile, DEFAULT_CONFIG.storage.sqliteFile);
  assert.equal(resolved.sessionTimeoutMs, DEFAULT_CONFIG.sessionTimeoutMs);

  const empty = resolveConfig();
  assert.deepEqual(empty.storage, DEFAULT_CONFIG.storage);
  assert.equal(empty.ai, undefined);
});

test("createStorage factory returns the requested implementation", () => {
  const dir = tempDir();
  try {
    assert.ok(createStorage(dir, "jsonl", "uba.sqlite") instanceof JsonlStorage);
    assert.ok(createStorage(dir, "sqlite", "uba.sqlite") instanceof SqliteStorage);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
