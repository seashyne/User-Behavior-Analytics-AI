/**
 * Public API of uba-ai.
 *
 * Typical usage:
 *   import { createUBAClient } from "uba-ai";
 *   const uba = createUBAClient();          // persists to ./uba-data
 *   uba.track({ userId: "u1", event: "signup" });
 *   const dwell = uba.watch("u1", { contentType: "article", contentId: "/blog/x" });
 *   dwell.start();  ...later...  dwell.stop();   // measures reading time
 *   const report = await uba.report();      // full AI analysis
 */
import { EventStore } from "./store.ts";
import { sessionize } from "./sessionizer.ts";
import { computeFunnel, computeOverview, computeRetention } from "./metrics.ts";
import { detectAnomalies } from "./anomaly.ts";
import { segmentUsers } from "./segment.ts";
import { generateInsights } from "./insights.ts";
import { generateNarrative, type NarrativeOptions } from "./ai.ts";
import { computeContentEngagement, DwellTracker, viewEvent, type ContentView } from "./content.ts";
import type { AnalysisReport, TrackInput, UBAConfig, UBAEvent } from "./types.ts";

export * from "./types.ts";
export { EventStore } from "./store.ts";
export { DEFAULT_CONFIG, resolveConfig } from "./config.ts";
export type { UBAConfig, StorageConfig, AIConfig } from "./config.ts";
export { JsonlStorage, SqliteStorage, createStorage } from "./storage.ts";
export type { EventStorage } from "./storage.ts";
export { sessionize } from "./sessionizer.ts";
export { computeOverview, computeFunnel, computeRetention, dayKey } from "./metrics.ts";
export { detectAnomalies } from "./anomaly.ts";
export { extractUserFeatures, kmeans, segmentUsers } from "./segment.ts";
export { generateInsights, formatDuration } from "./insights.ts";
export { generateNarrative, buildOfflineNarrative } from "./ai.ts";
export type { NarrativeOptions } from "./ai.ts";
export { DwellTracker, computeContentEngagement, viewEvent, CONTENT_VIEW_EVENT, CONTENT_TIME_EVENT } from "./content.ts";
export type { ContentView, ContentType, ContentReport, ContentEngagement, ContentTypeEngagement, TrackSink } from "./content.ts";
export { version, patchUpdates } from "./version.ts";
export type { PatchUpdate, VersionRecord } from "./version.ts";

/** Options for createUBAClient(). */
export interface UBAClientOptions extends Partial<UBAConfig> {
  /** Funnel steps used by analyze()/report() by default. */
  funnelSteps?: string[];
  /** Max retention day to compute. Default: 7. */
  retentionDays?: number;
}

/** High-level analytics client tying the store to every analysis layer. */
export class UBAClient {
  readonly store: EventStore;
  private readonly funnelSteps: string[];
  private readonly retentionDays: number;

  constructor(options: UBAClientOptions = {}) {
    const { funnelSteps, retentionDays, ...config } = options;
    this.store = new EventStore(config);
    this.funnelSteps = funnelSteps ?? [];
    this.retentionDays = retentionDays ?? 7;
  }

  /** Create data dir, persist config, initialize storage. Safe to repeat. */
  init(): this {
    this.store.init();
    return this;
  }

  /** Record a single user behavior event. */
  track(input: TrackInput): UBAEvent {
    return this.store.track(input);
  }

  /** Record many events at once (single batched write). */
  trackBatch(inputs: TrackInput[]): UBAEvent[] {
    return this.store.trackBatch(inputs);
  }

  /**
   * Record that a user is looking at a piece of content right now
   * (page / article / image / video ...). One-shot convenience wrapper
   * around the content_view event; use watch() when you also want the
   * dwell-time measurement.
   */
  view(userId: string, view: ContentView, timestamp?: number): UBAEvent {
    return this.store.track(viewEvent(userId, view, timestamp));
  }

  /**
   * Create a DwellTracker for one user + content item: start() records the
   * view and starts the clock, stop() records content_time with elapsed
   * dwellMs. Wire it to visibility signals (IntersectionObserver, route
   * changes, tab focus) in a browser, or call start/stop manually on a
   * server or in scripts.
   */
  watch(userId: string, view: ContentView): DwellTracker {
    return new DwellTracker(this.store, userId, view);
  }

  /** Read all stored events. */
  events(): UBAEvent[] {
    return this.store.readAll();
  }

  /** Release storage resources (closes the SQLite handle when in use). */
  close(): void {
    this.store.close();
  }

  /**
   * Run the full analysis pipeline: sessionize -> metrics -> funnel ->
   * retention -> content engagement -> anomalies -> segments -> insights.
   * This is a pure computation over whatever events are currently stored.
   */
  analyze(funnelSteps?: string[]): AnalysisReport {
    const events = this.store.readAll();
    const sessions = sessionize(events, this.store.config.sessionTimeoutMs);
    const overview = computeOverview(events, sessions);
    const steps = funnelSteps ?? this.funnelSteps;
    const retention = computeRetention(events, this.retentionDays);
    const content = computeContentEngagement(events);
    const anomalies = detectAnomalies(overview, this.store.config.anomalyZThreshold);
    const segments = segmentUsers(events, sessions, this.store.config.segmentCount);

    const report: AnalysisReport = {
      generatedAt: Date.now(),
      overview,
      retention,
      funnel: steps.length > 0 ? computeFunnel(events, steps) : null,
      anomalies,
      segments,
      content,
      insights: [],
    };
    report.insights = generateInsights(report);
    return report;
  }

  /** analyze() plus a narrative report (LLM when configured, otherwise offline template). */
  async report(funnelSteps?: string[], narrativeOptions?: NarrativeOptions): Promise<{ analysis: AnalysisReport; narrative: string; source: "llm" | "offline" }> {
    const analysis = this.analyze(funnelSteps);
    const cfg = this.store.config.ai;
    const narrative = await generateNarrative(analysis, {
      ...(cfg ? { baseUrl: cfg.baseUrl, model: cfg.model, apiKeyEnv: cfg.apiKeyEnv } : {}),
      ...narrativeOptions,
    });
    return { analysis, narrative: narrative.text, source: narrative.source };
  }
}

/** Factory for the common case. */
export function createUBAClient(options: UBAClientOptions = {}): UBAClient {
  return new UBAClient(options);
}
