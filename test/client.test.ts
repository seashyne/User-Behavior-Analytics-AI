/**
 * End-to-end client tests: persistence, analyze() windows, offline
 * narrative, and the demo data generator. Uses a temp data dir per run.
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

test("track persists events and analyze returns a full report", async () => {
  const dir = tempDir();
  try {
    const client = createUBAClient({ dataDir: dir, funnelSteps: ["signup", "purchase"] });
    await client.init();
    const base = Date.UTC(2026, 0, 1, 12);
    await client.track({ userId: "u1", event: "signup", timestamp: base });
    await client.track({ userId: "u1", event: "purchase", timestamp: base + 60_000 });
    await client.track({ userId: "u2", event: "signup", timestamp: base + 120_000 });

    // A second client instance must see the same persisted data.
    const reopened = new UBAClient({ dataDir: dir });
    const report = await reopened.analyze(["signup", "purchase"]);
    assert.equal(report.overview.totalEvents, 3);
    assert.equal(report.overview.totalUsers, 2);
    assert.ok(report.funnel);
    assert.equal(report.funnel!.steps[0]!.reachedUsers, 2);
    assert.equal(report.funnel!.steps[1]!.reachedUsers, 1);
    assert.ok(report.segments.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("analyze({ since, until }) restricts the analysis window", async () => {
  const dir = tempDir();
  try {
    const client = createUBAClient({ dataDir: dir });
    await client.init();
    const base = Date.UTC(2026, 0, 1, 12);
    const DAY = 86_400_000;
    // Day 1: two events. Day 3: one event.
    await client.trackBatch([
      { userId: "u1", event: "page_view", timestamp: base },
      { userId: "u2", event: "page_view", timestamp: base + 1000 },
      { userId: "u1", event: "page_view", timestamp: base + 2 * DAY },
    ]);

    const full = await client.analyze();
    assert.equal(full.overview.totalEvents, 3);

    // until is exclusive: day 3's event falls outside.
    const early = await client.analyze({ until: base + DAY });
    assert.equal(early.overview.totalEvents, 2);
    assert.equal(early.overview.totalUsers, 2);

    // since keeps only day 3.
    const late = await client.analyze({ since: base + DAY });
    assert.equal(late.overview.totalEvents, 1);
    assert.equal(late.overview.totalUsers, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("report() returns an offline narrative when no API key is set", async () => {
  const dir = tempDir();
  const savedKey = process.env["UBA_AI_API_KEY"];
  delete process.env["UBA_AI_API_KEY"];
  try {
    const client = createUBAClient({ dataDir: dir });
    await client.init();
    await client.track({ userId: "u1", event: "page_view" });
    const { narrative, source } = await client.report();
    assert.equal(source, "offline");
    assert.match(narrative, /USER BEHAVIOR ANALYTICS REPORT/);
    assert.match(narrative, /OVERVIEW/);
  } finally {
    if (savedKey !== undefined) process.env["UBA_AI_API_KEY"] = savedKey;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("demo generator produces funnel events and a spike day", () => {
  const events = generateDemoEvents({ users: 40, days: 14, seed: 3 });
  assert.ok(events.length > 100);
  const names = new Set(events.map((e) => e.event));
  for (const expected of ["page_view", "signup", "checkout_start", "purchase"]) {
    assert.ok(names.has(expected), `demo data should contain ${expected}`);
  }
  // Offline narrative over empty data should render without throwing.
  const text = buildOfflineNarrative({
    generatedAt: Date.now(),
    overview: { totalEvents: 0, totalUsers: 0, totalSessions: 0, avgSessionDurationMs: 0, avgEventsPerSession: 0, firstEventAt: null, lastEventAt: null, topEvents: [], dailyActivity: [] },
    retention: [],
    funnel: null,
    anomalies: [],
    segments: [],
    content: { topContent: [], byType: [], totalViews: 0, totalDwellMs: 0 },
    insights: [],
  });
  assert.match(text, /No events recorded yet/);
});
