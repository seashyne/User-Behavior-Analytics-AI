/**
 * Core pipeline tests: sessionizer, metrics, anomaly, segmentation.
 * Run with `npm test` (Node's built-in test runner + type stripping).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sessionize } from "../src/sessionizer.ts";
import { computeFunnel, computeOverview, computeRetention } from "../src/metrics.ts";
import { detectAnomalies } from "../src/anomaly.ts";
import { segmentUsers } from "../src/segment.ts";
import { generateInsights } from "../src/insights.ts";
import type { UBAEvent } from "../src/types.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Helper to build events quickly. */
function ev(userId: string, event: string, timestamp: number): UBAEvent {
  return { id: `${userId}-${event}-${timestamp}`, userId, event, timestamp };
}

test("sessionize splits sessions on inactivity gap", () => {
  const base = Date.UTC(2026, 0, 1, 10, 0, 0);
  const events = [
    ev("u1", "page_view", base),
    ev("u1", "click", base + 5 * MINUTE),
    // 2-hour gap exceeds the 30-minute timeout -> new session
    ev("u1", "page_view", base + 125 * MINUTE),
    ev("u2", "page_view", base + MINUTE),
  ];
  const sessions = sessionize(events, 30 * MINUTE);
  assert.equal(sessions.length, 3);
  const u1Sessions = sessions.filter((s) => s.userId === "u1");
  assert.equal(u1Sessions.length, 2);
  assert.equal(u1Sessions[0]!.eventCount, 2);
  assert.equal(u1Sessions[1]!.eventCount, 1);
  // Events get their sessionId written back.
  assert.ok(events.every((e) => typeof e.sessionId === "string"));
});

test("computeFunnel requires ordered step completion per user", () => {
  const base = Date.UTC(2026, 0, 1);
  const events = [
    // u1 completes the full funnel in order.
    ev("u1", "signup", base),
    ev("u1", "checkout", base + MINUTE),
    ev("u1", "purchase", base + 2 * MINUTE),
    // u2 signs up but never checks out.
    ev("u2", "signup", base),
    // u3 checks out before signing up: order violated -> stops at signup.
    ev("u3", "checkout", base),
    ev("u3", "signup", base + 5 * MINUTE),
  ];
  const funnel = computeFunnel(events, ["signup", "checkout", "purchase"]);
  // All three users fired signup; only u1 completed checkout and purchase
  // (u3 checked out before signing up, violating the required order).
  assert.deepEqual(funnel.steps.map((s) => s.reachedUsers), [3, 1, 1]);
  assert.ok(Math.abs(funnel.overallConversion - 1 / 3) < 1e-9);
  assert.equal(funnel.dropoffStep, "checkout");
});

test("computeRetention counts day-N returns", () => {
  const base = Date.UTC(2026, 0, 1);
  const events = [
    ev("u1", "page_view", base),
    ev("u1", "page_view", base + DAY), // day-1 return
    ev("u2", "page_view", base),
    ev("u2", "page_view", base + 2 * DAY), // day-2 return only
  ];
  const retention = computeRetention(events, 3);
  const d1 = retention.find((r) => r.day === 1)!;
  const d2 = retention.find((r) => r.day === 2)!;
  assert.equal(d1.rate, 0.5);
  assert.equal(d2.rate, 0.5);
});

test("computeOverview aggregates counts and daily activity", () => {
  const base = Date.UTC(2026, 0, 1, 12);
  const events = [ev("u1", "page_view", base), ev("u1", "click", base + MINUTE), ev("u2", "page_view", base + DAY)];
  const sessions = sessionize(events, 30 * MINUTE);
  const overview = computeOverview(events, sessions);
  assert.equal(overview.totalEvents, 3);
  assert.equal(overview.totalUsers, 2);
  assert.equal(overview.topEvents[0]!.event, "page_view");
  assert.equal(overview.topEvents[0]!.count, 2);
  assert.equal(overview.dailyActivity.length, 2);
});

test("detectAnomalies flags an injected spike day", () => {
  const base = Date.UTC(2026, 0, 1, 12);
  const events: UBAEvent[] = [];
  // 9 calm days with 10 events each, then one day with 200 events.
  for (let d = 0; d < 10; d++) {
    const count = d === 9 ? 200 : 10;
    for (let i = 0; i < count; i++) {
      events.push(ev(`u${i % 5}`, "page_view", base + d * DAY + i * 1000));
    }
  }
  const sessions = sessionize(events, 30 * MINUTE);
  const overview = computeOverview(events, sessions);
  const anomalies = detectAnomalies(overview, 2);
  const spike = anomalies.find((a) => a.metric === "daily_events" && a.direction === "spike");
  assert.ok(spike, "expected a spike anomaly");
  assert.equal(spike!.value, 200);
});

test("segmentUsers separates power users from casual users", () => {
  const base = Date.UTC(2026, 0, 1, 12);
  const events: UBAEvent[] = [];
  // 3 heavy users: active every day with many events.
  for (let d = 0; d < 10; d++) {
    for (let p = 0; p < 3; p++) {
      for (let i = 0; i < 15; i++) {
        events.push(ev(`power-${p}`, i % 2 === 0 ? "page_view" : "click", base + d * DAY + i * MINUTE));
      }
    }
  }
  // 6 casual users: one short visit each.
  for (let c = 0; c < 6; c++) {
    events.push(ev(`casual-${c}`, "page_view", base + c * 10 * MINUTE));
  }
  const sessions = sessionize(events, 30 * MINUTE);
  const segments = segmentUsers(events, sessions, 2);
  assert.equal(segments.length, 2);
  const power = segments.find((s) => s.label === "Power Users")!;
  const casual = segments.find((s) => s.label === "Casual / At-Risk Users")!;
  assert.deepEqual(power.userIds.slice().sort(), ["power-0", "power-1", "power-2"]);
  assert.equal(casual.userCount, 6);
});

test("generateInsights flags critical day-1 retention and no-data state", () => {
  const empty = { generatedAt: Date.now(), overview: computeOverview([], []), retention: [], funnel: null, anomalies: [], segments: [], insights: [] };
  const emptyInsights = generateInsights(empty);
  assert.equal(emptyInsights.length, 1);
  assert.equal(emptyInsights[0]!.title, "No data yet");

  const base = Date.UTC(2026, 0, 1, 12);
  const events: UBAEvent[] = [];
  // 20 users visit day 0; only 2 return on day 1 -> 10% retention (critical).
  for (let u = 0; u < 20; u++) events.push(ev(`u${u}`, "page_view", base));
  for (let u = 0; u < 2; u++) events.push(ev(`u${u}`, "page_view", base + DAY));
  const sessions = sessionize(events, 30 * MINUTE);
  const overview = computeOverview(events, sessions);
  const report = { generatedAt: Date.now(), overview, retention: computeRetention(events, 2), funnel: null, anomalies: [], segments: [], insights: [] };
  const insights = generateInsights(report);
  const critical = insights.find((i) => i.severity === "critical");
  assert.ok(critical, "expected a critical retention insight");
  assert.match(critical!.title, /retention/i);
});
