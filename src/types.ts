/**
 * Core type definitions for uba-ai.
 *
 * Everything in the package revolves around UBAEvent: a single recorded
 * user action. Higher layers (sessions, metrics, anomalies, segments,
 * insights) are all derived from streams of these events.
 */

/** A single tracked user behavior event. */
export interface UBAEvent {
  /** Unique event id (auto-generated when ingested via the client). */
  id: string;
  /** Stable identifier of the user who produced the event. */
  userId: string;
  /** Event name, e.g. "page_view", "signup", "purchase". */
  event: string;
  /** Unix epoch milliseconds when the event happened. */
  timestamp: number;
  /** Arbitrary event payload (page url, value, device, ...). */
  properties?: Record<string, unknown>;
  /** Session id assigned by the sessionizer (filled during analysis). */
  sessionId?: string;
}

/** Input accepted by track(): id is optional and will be generated. */
export type TrackInput = Omit<UBAEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: number;
};

/** Runtime configuration persisted in uba.config.json inside the data dir. */
export interface UBAConfig {
  /** Directory holding events.jsonl and uba.config.json. */
  dataDir: string;
  /** Inactivity gap (ms) that closes a session. Default: 30 minutes. */
  sessionTimeoutMs: number;
  /** Number of behavioral segments for k-means. Default: 3. */
  segmentCount: number;
  /** Z-score threshold above which a daily count is an anomaly. Default: 2. */
  anomalyZThreshold: number;
  /** Optional OpenAI-compatible endpoint for AI narrative reports. */
  ai?: {
    baseUrl: string;
    model: string;
    apiKeyEnv: string;
  };
}

/** A group of events belonging to one continuous visit. */
export interface Session {
  sessionId: string;
  userId: string;
  start: number;
  end: number;
  durationMs: number;
  eventCount: number;
  events: UBAEvent[];
}

/** Aggregate numbers describing the whole dataset. */
export interface OverviewMetrics {
  totalEvents: number;
  totalUsers: number;
  totalSessions: number;
  avgSessionDurationMs: number;
  avgEventsPerSession: number;
  firstEventAt: number | null;
  lastEventAt: number | null;
  /** Event name -> count, sorted descending. */
  topEvents: Array<{ event: string; count: number }>;
  /** ISO date (yyyy-mm-dd) -> event count, sorted ascending. */
  dailyActivity: Array<{ date: string; events: number; users: number }>;
}

/** Result of a funnel analysis over ordered step event names. */
export interface FunnelResult {
  steps: Array<{ event: string; reachedUsers: number; conversionFromPrevious: number | null }>;
  overallConversion: number;
  dropoffStep: string | null;
}

/** Day-N retention: fraction of first-seen users active again N days later. */
export interface RetentionPoint {
  day: number;
  cohortSize: number;
  retained: number;
  rate: number;
}

/** A detected anomaly in a daily metric series. */
export interface Anomaly {
  date: string;
  metric: string;
  value: number;
  mean: number;
  stdDev: number;
  zScore: number;
  direction: "spike" | "drop";
}

/** A behavioral user segment produced by k-means clustering. */
export interface Segment {
  id: number;
  label: string;
  userCount: number;
  /** Mean value of each clustering feature within the segment. */
  centroid: Record<string, number>;
  userIds: string[];
}

/** A single actionable finding produced by the rule-based insight engine. */
export interface Insight {
  severity: "info" | "warning" | "critical";
  category: "engagement" | "funnel" | "retention" | "anomaly" | "segmentation";
  title: string;
  detail: string;
}

/** The complete analysis output returned by analyze(). */
export interface AnalysisReport {
  generatedAt: number;
  overview: OverviewMetrics;
  retention: RetentionPoint[];
  funnel: FunnelResult | null;
  anomalies: Anomaly[];
  segments: Segment[];
  insights: Insight[];
}
