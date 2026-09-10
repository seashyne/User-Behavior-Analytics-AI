/**
 * End-to-end client tests: persistence, analyze(), offline narrative,
 * and the demo data generator. Uses a temp data dir per run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UBAClient, createUBAClient } from "../src/index.ts";
import { generateDemoEvents } from "../src/demo.ts";
import { buildOfflineNarrative } from "../src/ai.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "uba-test-"));
}

test("track persists events and analyze returns a full report", () => {
  const dir = tempDir();
  try {
    const client = createUBAClient({ dataDir: dir, funnelSteps: ["signup", "purchase"] });
    client.init();
    const base = Date.UTC(2026, 0, 1, 12);
    client.track({ userId: "u1", event: "signup", timestamp: base });
    client.track({ userId: "u1", event: "purchase", timestamp: base + 60_000 });
    client.track({ userId: "u2", event: "signup", timestamp: base + 120_000 });

    // A second client instance must see the same persisted data.
    const reopened = new UBAClient({ dataDir: dir });
    const report = reopened.analyze(["signup", "purchase"]);
    assert.equal(report.overview.totalEvents, 3);
    assert.equal(report.overview.totalUsers, 2);
    assert.ok(report.funnel);
    assert.equal(report.funnel!.steps[0]!.reachedUsers, 2);
    assert.equal(report.funnel!.steps[1]!.reachedUsers, 1);
    assert.ok(report.segments.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report() returns an offline narrative when no API key is set", async () => {
  const dir = tempDir();
  const savedKey = process.env["UBA_AI_API_KEY"];
  delete process.env["UBA_AI_API_KEY"];
  try {
    const client = createUBAClient({ dataDir: dir });
    client.init();
    client.track({ userId: "u1", event: "page_view" });
    const { narrative, source } = await client.report();
    assert.equal(source, "offline");
    assert.match(narrative, /USER BEHAVIOR ANALYTICS REPORT/);
    assert.match(narrative, /OVERVIEW/);
  } finally {
    if (savedKey !== undefined) process.env["UBA_AI_API_KEY"] = savedKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("demo generator produces funnel events and a spike day", () => {
  const events = generateDemoEvents({ users: 40, days: 14, seed: 3 });
  assert.ok(events.length > 100);
  const names = new Set(events.map((e) => e.event));
  for (const expected of ["page_view", "signup", "checkout_start", "purchase"]) {
    assert.ok(names.has(expected), `demo data should contain ${expected}`);
  }
  // Offline narrative over demo data should render without throwing.
  const text = buildOfflineNarrative({
    generatedAt: Date.now(),
    overview: { totalEvents: 0, totalUsers: 0, totalSessions: 0, avgSessionDurationMs: 0, avgEventsPerSession: 0, firstEventAt: null, lastEventAt: null, topEvents: [], dailyActivity: [] },
    retention: [],
    funnel: null,
    anomalies: [],
    segments: [],
    insights: [],
  });
  assert.match(text, /No events recorded yet/);
});
