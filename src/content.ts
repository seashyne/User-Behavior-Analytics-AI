/**
 * Content-level tracking and engagement analysis.
 *
 * Answers "what is the user looking at right now, and for how long".
 * Two event conventions power this layer:
 * - content_view: fired when a piece of content becomes visible (page,
 *   article, image, video, product card...). Carries contentType/contentId
 *   and optional title/url plus any custom properties.
 * - content_time: fired when the content stops being visible (navigation,
 *   tab switch, scroll away), carrying dwellMs and optional visibleRatio.
 *
 * DwellTracker pairs the two: start() emits content_view, stop() emits
 * content_time with the elapsed time. In a browser you would wire it to
 * IntersectionObserver / visibilitychange; on a server or in a CLI script
 * you simply call start/stop around the interaction.
 */
import type { TrackInput, UBAEvent } from "./types.ts";

/** Kinds of content the tracker understands (extensible via free strings). */
export type ContentType = "page" | "article" | "image" | "video" | "component" | (string & {});

/** Description of the content a user is looking at. */
export interface ContentView {
  /** Content kind; drives per-type engagement rollups. */
  contentType: ContentType;
  /** Stable identifier: route path, article slug, image id, ... */
  contentId: string;
  /** Human-readable title when available (shown in reports). */
  title?: string;
  /** Canonical URL when available. */
  url?: string;
  /** Any extra dimensions (section, author, tags, viewport position...). */
  properties?: Record<string, unknown>;
}

/** Event name emitted when content becomes visible. */
export const CONTENT_VIEW_EVENT = "content_view";
/** Event name emitted when content visibility ends (carries dwellMs). */
export const CONTENT_TIME_EVENT = "content_time";

/** Build the content_view TrackInput for a view (pure helper, no tracking). */
export function viewEvent(userId: string, view: ContentView, timestamp?: number): TrackInput {
  return {
    userId,
    event: CONTENT_VIEW_EVENT,
    ...(timestamp !== undefined ? { timestamp } : {}),
    properties: {
      contentType: view.contentType,
      contentId: view.contentId,
      ...(view.title !== undefined ? { title: view.title } : {}),
      ...(view.url !== undefined ? { url: view.url } : {}),
      ...(view.properties ?? {}),
    },
  };
}

/** A value or a promise of it - lets sync and async sinks share one type. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Minimal sink the DwellTracker writes to. EventStore/UBAClient satisfy it
 * structurally (async since the storage contract became async; plain sync
 * fakes in tests still work thanks to MaybePromise).
 */
export interface TrackSink {
  track(input: TrackInput): MaybePromise<UBAEvent>;
}

/**
 * Pairs content_view with content_time for one user + content item.
 * Reusable: after stop() you may start() again (e.g. user scrolls back).
 */
export class DwellTracker {
  // Explicit fields instead of constructor parameter properties: Node's
  // strip-only TypeScript mode (used to run tests directly on src) does not
  // support the `constructor(private readonly x)` shorthand.
  private readonly sink: TrackSink;
  private readonly userId: string;
  private readonly view: ContentView;
  private startedAt: number | null = null;

  constructor(sink: TrackSink, userId: string, view: ContentView) {
    this.sink = sink;
    this.userId = userId;
    this.view = view;
  }

  /** Mark the content visible: records content_view and starts the clock. */
  async start(timestamp: number = Date.now()): Promise<void> {
    this.startedAt = timestamp;
    await this.sink.track(viewEvent(this.userId, this.view, timestamp));
  }

  /**
   * Mark the content hidden: records content_time with elapsed dwellMs.
   * visibleRatio (0..1) is optional - browsers can pass the observed
   * intersection ratio to distinguish a glance from a full read.
   * Returns the emitted event, or null when stop() precedes start().
   */
  async stop(timestamp: number = Date.now(), visibleRatio?: number): Promise<UBAEvent | null> {
    if (this.startedAt === null) return null;
    const dwellMs = Math.max(0, timestamp - this.startedAt);
    this.startedAt = null;
    return this.sink.track({
      userId: this.userId,
      event: CONTENT_TIME_EVENT,
      timestamp,
      properties: {
        contentType: this.view.contentType,
        contentId: this.view.contentId,
        ...(this.view.title !== undefined ? { title: this.view.title } : {}),
        dwellMs,
        ...(visibleRatio !== undefined ? { visibleRatio } : {}),
      },
    });
  }

  /** True while between start() and stop(). */
  get active(): boolean {
    return this.startedAt !== null;
  }
}

/** Per-content engagement rollup produced by computeContentEngagement. */
export interface ContentEngagement {
  contentType: ContentType;
  contentId: string;
  title: string | null;
  views: number;
  uniqueViewers: number;
  totalDwellMs: number;
  avgDwellMs: number;
}

/** Engagement aggregated per content type (page vs image vs article...). */
export interface ContentTypeEngagement {
  contentType: ContentType;
  views: number;
  totalDwellMs: number;
  avgDwellMs: number;
}

/** Result of the whole content analysis layer. */
export interface ContentReport {
  /** Individual content items sorted by total dwell time, then views. */
  topContent: ContentEngagement[];
  /** Per-type rollup sorted by total dwell time. */
  byType: ContentTypeEngagement[];
  totalViews: number;
  totalDwellMs: number;
}

/**
 * Aggregate content_view / content_time events into engagement numbers.
 * Pure function over the event stream so it works with any storage backend
 * and is trivially testable.
 */
export function computeContentEngagement(events: UBAEvent[]): ContentReport {
  const items = new Map<string, { meta: ContentView & { title?: string }; views: number; viewers: Set<string>; dwellMs: number; dwellSamples: number }>();

  const ensure = (contentType: string, contentId: string, title?: unknown): { meta: ContentView & { title?: string }; views: number; viewers: Set<string>; dwellMs: number; dwellSamples: number } => {
    const key = `${contentType}\u0000${contentId}`;
    let entry = items.get(key);
    if (!entry) {
      entry = { meta: { contentType, contentId }, views: 0, viewers: new Set(), dwellMs: 0, dwellSamples: 0 };
      items.set(key, entry);
    }
    if (typeof title === "string" && title) entry.meta.title = title;
    return entry;
  };

  for (const event of events) {
    const props = event.properties ?? {};
    const contentType = typeof props["contentType"] === "string" ? (props["contentType"] as string) : "unknown";
    const contentId = typeof props["contentId"] === "string" ? (props["contentId"] as string) : "unknown";
    if (event.event === CONTENT_VIEW_EVENT) {
      const entry = ensure(contentType, contentId, props["title"]);
      entry.views += 1;
      entry.viewers.add(event.userId);
    } else if (event.event === CONTENT_TIME_EVENT) {
      const entry = ensure(contentType, contentId, props["title"]);
      const dwell = typeof props["dwellMs"] === "number" ? props["dwellMs"] : 0;
      entry.dwellMs += dwell;
      entry.dwellSamples += 1;
    }
  }

  const topContent: ContentEngagement[] = [...items.values()]
    .map((entry) => ({
      contentType: entry.meta.contentType,
      contentId: entry.meta.contentId,
      title: entry.meta.title ?? null,
      views: entry.views,
      uniqueViewers: entry.viewers.size,
      totalDwellMs: entry.dwellMs,
      // Average over recorded dwell samples; 0 when nobody's time was measured.
      avgDwellMs: entry.dwellSamples > 0 ? entry.dwellMs / entry.dwellSamples : 0,
    }))
    // Attention (dwell) matters more than raw clicks, so sort by time first.
    .sort((a, b) => b.totalDwellMs - a.totalDwellMs || b.views - a.views);

  const byTypeMap = new Map<string, ContentTypeEngagement>();
  for (const item of topContent) {
    const bucket = byTypeMap.get(item.contentType) ?? { contentType: item.contentType, views: 0, totalDwellMs: 0, avgDwellMs: 0 };
    bucket.views += item.views;
    bucket.totalDwellMs += item.totalDwellMs;
    byTypeMap.set(item.contentType, bucket);
  }
  const byType = [...byTypeMap.values()]
    .map((bucket) => ({ ...bucket, avgDwellMs: bucket.views > 0 ? bucket.totalDwellMs / bucket.views : 0 }))
    .sort((a, b) => b.totalDwellMs - a.totalDwellMs);

  return {
    topContent,
    byType,
    totalViews: topContent.reduce((sum, i) => sum + i.views, 0),
    totalDwellMs: topContent.reduce((sum, i) => sum + i.totalDwellMs, 0),
  };
}
