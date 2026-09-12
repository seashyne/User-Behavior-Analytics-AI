/**
 * Content-level tracking tests: DwellTracker pairing, content engagement
 * aggregation, and the "user is looking at X" question end to end.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUBAClient } from "../src/index.ts";
import { computeContentEngagement, DwellTracker, viewEvent, CONTENT_TIME_EVENT, CONTENT_VIEW_EVENT } from "../src/content.ts";
import type { TrackInput, UBAEvent } from "../src/types.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "uba-content-"));
}

test("viewEvent builds a content_view input with all fields", () => {
  const input = viewEvent("u1", { contentType: "article", contentId: "/blog/x", title: "Post X", url: "https://a.dev/blog/x", properties: { section: "intro" } }, 123);
  assert.equal(input.event, CONTENT_VIEW_EVENT);
  assert.equal(input.userId, "u1");
  assert.equal(input.timestamp, 123);
  assert.equal(input.properties?.["contentType"], "article");
  assert.equal(input.properties?.["title"], "Post X");
  assert.equal(input.properties?.["section"], "intro");
});

test("DwellTracker emits content_view then content_time with elapsed ms", async () => {
  const tracked: TrackInput[] = [];
  // Sync fake sink: valid against the MaybePromise TrackSink contract.
  const sink = { track: (input: TrackInput) => { tracked.push(input); return { id: "x", timestamp: 0, ...input } as UBAEvent; } };
  const dwell = new DwellTracker(sink, "u1", { contentType: "image", contentId: "img-9", title: "Hero" });

  assert.equal(dwell.active, false);
  await dwell.start(1_000);
  assert.equal(dwell.active, true);
  const stopEvent = await dwell.stop(6_000, 0.75);
  assert.equal(dwell.active, false);

  assert.equal(tracked.length, 2);
  assert.equal(tracked[0]!.event, CONTENT_VIEW_EVENT);
  assert.equal(tracked[0]!.timestamp, 1_000);
  assert.equal(tracked[1]!.event, CONTENT_TIME_EVENT);
  assert.equal(tracked[1]!.properties?.["dwellMs"], 5_000);
  assert.equal(tracked[1]!.properties?.["visibleRatio"], 0.75);
  assert.ok(stopEvent);

  // stop() before start() is a no-op instead of emitting bogus data.
  assert.equal(await dwell.stop(9_000), null);
  assert.equal(tracked.length, 2);
});

test("computeContentEngagement aggregates views, viewers, and dwell per item and type", () => {
  const base = Date.UTC(2026, 0, 1);
  const events: UBAEvent[] = [
    // Article read by two users with measured dwell.
    { id: "1", userId: "u1", event: CONTENT_VIEW_EVENT, timestamp: base, properties: { contentType: "article", contentId: "/blog/a", title: "A" } },
    { id: "2", userId: "u1", event: CONTENT_TIME_EVENT, timestamp: base + 60_000, properties: { contentType: "article", contentId: "/blog/a", title: "A", dwellMs: 60_000 } },
    { id: "3", userId: "u2", event: CONTENT_VIEW_EVENT, timestamp: base, properties: { contentType: "article", contentId: "/blog/a", title: "A" } },
    { id: "4", userId: "u2", event: CONTENT_TIME_EVENT, timestamp: base + 30_000, properties: { contentType: "article", contentId: "/blog/a", title: "A", dwellMs: 30_000 } },
    // Image viewed many times but dwell never measured -> avgDwell 0.
    { id: "5", userId: "u1", event: CONTENT_VIEW_EVENT, timestamp: base, properties: { contentType: "image", contentId: "img-1" } },
    { id: "6", userId: "u2", event: CONTENT_VIEW_EVENT, timestamp: base, properties: { contentType: "image", contentId: "img-1" } },
    // Non-content events must be ignored by this layer.
    { id: "7", userId: "u1", event: "page_view", timestamp: base },
  ];
  const report = computeContentEngagement(events);
  assert.equal(report.totalViews, 4);

  const article = report.topContent.find((c) => c.contentId === "/blog/a")!;
  assert.equal(article.views, 2);
  assert.equal(article.uniqueViewers, 2);
  assert.equal(article.totalDwellMs, 90_000);
  assert.equal(article.avgDwellMs, 45_000);
  assert.equal(article.title, "A");

  const image = report.topContent.find((c) => c.contentId === "img-1")!;
  assert.equal(image.totalDwellMs, 0);

  // Article holds more attention -> sorts first; byType rollup matches.
  assert.equal(report.topContent[0]!.contentId, "/blog/a");
  assert.equal(report.byType[0]!.contentType, "article");
  assert.equal(report.byType.find((t) => t.contentType === "image")!.views, 2);
});

test("client.watch + analyze answers what users are looking at, end to end", async () => {
  const dir = tempDir();
  try {
    const client = createUBAClient({ dataDir: dir });
    await client.init();
    // One-shot view: user is looking at an image right now.
    await client.view("u1", { contentType: "image", contentId: "hero.jpg", title: "Hero image" }, Date.UTC(2026, 0, 1));
    // Dwell-tracked article read of exactly 2 minutes.
    const dwell = client.watch("u1", { contentType: "article", contentId: "/blog/deep-dive", title: "Deep Dive" });
    await dwell.start(Date.UTC(2026, 0, 1, 1));
    await dwell.stop(Date.UTC(2026, 0, 1, 1, 2));

    const report = await client.analyze();
    assert.equal(report.content.totalViews, 2);
    const article = report.content.topContent.find((c) => c.contentId === "/blog/deep-dive")!;
    assert.equal(article.totalDwellMs, 2 * 60_000);

    // The insight engine surfaces the most engaging content automatically.
    const contentInsight = report.insights.find((i) => i.category === "content");
    assert.ok(contentInsight);
    assert.match(contentInsight!.detail, /Deep Dive/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
