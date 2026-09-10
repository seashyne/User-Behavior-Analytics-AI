/**
 * Public API of uba-ai.
 *
 * Typical usage:
 *   import { createUBAClient } from "uba-ai";
 *   const uba = createUBAClient();          // persists to ./uba-data
 *   uba.track({ userId: "u1", event: "signup" });
 *   const report = await uba.report();      // full AI analysis
 */
import { EventStore } from "./store.ts";
import { sessionize } from "./sessionizer.ts";
import { computeFunnel, computeOverview, computeRetention } from "./metrics.ts";
import { detectAnomalies } from "./anomaly.ts";
import { segmentUsers } from "./segment.ts";
import { generateInsights } from "./insights.ts";
import { generateNarrative, type NarrativeOptions } from "./ai.ts";
import type { AnalysisReport, TrackInput, UBAConfig, UBAEvent } from "./types.ts";

export * from "./types.ts";
export { EventStore, DEFAULT_CONFIG } from "./store.ts";
export { sessionize } from "./sessionizer.ts";
export { computeOverview, computeFunnel, computeRetention, dayKey } from "./metrics.ts";
export { detectAnomalies } from "./anomaly.ts";
export { extractUserFeatures, kmeans, segmentUsers } from "./segment.ts";
export { generateInsights, formatDuration } from "./insights.ts";
export { generateNarrative, buildOfflineNarrative } from "./ai.ts";
export type { NarrativeOptions } from "./ai.ts";

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

  /** Create data dir and persist config. Safe to call multiple times. */
  init(): this {
    this.store.init();
    return this;
  }

  /** Record a single user behavior event. */
  track(input: TrackInput): UBAEvent {
    return this.store.track(input);
  }

  /** Record many events at once. */
  trackBatch(inputs: TrackInput[]): UBAEvent[] {
    return this.store.trackBatch(inputs);
  }

  /** Read all stored events. */
  events(): UBAEvent[] {
    return this.store.readAll();
  }

  /**
   * Run the full analysis pipeline: sessionize -> metrics -> funnel ->
   * retention -> anomalies -> segments -> insights.
   * This is a pure computation over whatever events are currently stored.
   */
  analyze(funnelSteps?: string[]): AnalysisReport {
    const events = this.store.readAll();
    const sessions = sessionize(events, this.store.config.sessionTimeoutMs);
    const overview = computeOverview(events, sessions);
    const steps = funnelSteps ?? this.funnelSteps;
    const retention = computeRetention(events, this.retentionDays);
    const anomalies = detectAnomalies(overview, this.store.config.anomalyZThreshold);
    const segments = segmentUsers(events, sessions, this.store.config.segmentCount);

    const report: AnalysisReport = {
      generatedAt: Date.now(),
      overview,
      retention,
      funnel: steps.length > 0 ? computeFunnel(events, steps) : null,
      anomalies,
      segments,
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
