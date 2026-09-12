/**
 * Version registry for uba-ai.
 *
 * Mirrors the release convention used across the Alenout Project: a single
 * source of truth for the active version plus a structured patchUpdates log
 * documenting every addition, fix, and improvement per release. Bump
 * `version` here AND in package.json together before any publish (the
 * pre-deploy rule), and prepend a new patchUpdates entry describing the work.
 */

/** Active application version. Must match package.json "version". */
export const version = "0.3.0";

/** One documented change within a release. */
export interface PatchUpdate {
  /** Change kind, following conventional-commit categories. */
  type: "feat" | "fix" | "improve" | "docs" | "build";
  /** One-line summary of the change. */
  message: string;
}

/** A released version with its documented changes. */
export interface VersionRecord {
  version: string;
  /** Release date in ISO format (yyyy-mm-dd). */
  date: string;
  /** All additions/fixes/improvements shipped in this release. */
  patchUpdates: PatchUpdate[];
}

/**
 * Release history, newest first. Every entry must be written at release
 * time (mandatory work & version report rule) so the changelog never drifts
 * from what actually shipped.
 */
export const patchUpdates: VersionRecord[] = [
  {
    version: "0.3.0",
    date: "2026-09-10",
    patchUpdates: [
      { type: "feat", message: "Async storage contract (breaking): every EventStorage method now returns a Promise, so remote SQL backends (Postgres/MySQL adapters, cloud storage) are implementable without a second API surface." },
      { type: "feat", message: "Time-windowed analysis: analyze()/report() accept { since, until } and the window is pushed into storage reads - the SQLite backend turns it into a WHERE clause on the timestamp index, keeping memory bounded on large datasets. CLI equivalents: uba analyze --since 7d / --until 2026-09-01 (relative durations, ISO dates, or epoch ms)." },
      { type: "feat", message: "UBAClient gained close() alongside the store for deterministic resource release." },
      { type: "improve", message: "UBAClient.analyze() accepts an AnalyzeOptions object while the older plain funnel-steps array form keeps working." },
      { type: "docs", message: "README migration guide for the v0.2 -> v0.3 async API change." },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-09-10",
    patchUpdates: [
      { type: "build", message: "CI pipeline (GitHub Actions): strict build + full test matrix on Node 20/22/24 across ubuntu and windows, dist smoke test on Node 20, graceful-failure guard for the sqlite backend on old Node, and npm pack integrity check." },
      { type: "build", message: "Machine-enforced pre-deploy rule: scripts/check-version.mjs verifies package.json, src/version.ts, and patchUpdates agree; wired into prepublishOnly and CI so an out-of-sync version can never publish." },
      { type: "feat", message: "Data schema versioning (src/schema.ts): SQLite databases are stamped via PRAGMA user_version, JSONL datasets via the schemaVersion marker in uba.config.json, with a forward-only transactional migration runner for future schema changes." },
      { type: "docs", message: "Added improvement report and post-v0.2.0 roadmap (docs/IMPROVEMENT_PLAN.md) plus the BMC/pricing strategy report (docs/BMC_PRICING.md)." },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-10",
    patchUpdates: [
      { type: "feat", message: "Pluggable storage layer: keep the default JSONL file or switch to SQL via the built-in node:sqlite backend (storage.backend in uba.config.json), still zero external dependencies." },
      { type: "feat", message: "Sectioned JSON configuration: storage, ai, and analysis settings are each separately overridable while every field keeps a built-in default, so a fresh install needs no config file at all." },
      { type: "feat", message: "Content-level tracking API: trackView records what a user is looking at (page/article/image/video with id, title, url), and DwellTracker measures how long content stays visible, emitting content_time events." },
      { type: "feat", message: "Content engagement analysis: top content by views and total dwell time, average time-on-content per type, included in analyze(), the CLI report, and the AI narrative." },
      { type: "feat", message: "uba view CLI command for recording content views from scripts or server code." },
      { type: "improve", message: "Batched writes: trackBatch now performs a single JSONL append or one SQLite transaction instead of per-event writes." },
      { type: "docs", message: "Added CHANGELOG.md and this in-code version registry (version + patchUpdates) kept in sync with package.json." },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-10",
    patchUpdates: [
      { type: "feat", message: "Initial release: event tracking with JSONL persistence, gap-based sessionization, overview/funnel/retention metrics." },
      { type: "feat", message: "Anomaly detection via robust z-scores on daily event volume and daily active users." },
      { type: "feat", message: "Behavioral segmentation via seeded k-means over normalized per-user features, labeled Power / Regular / Casual-At-Risk." },
      { type: "feat", message: "Rule-based insight engine with severity levels, fully offline." },
      { type: "feat", message: "Optional LLM narrative reports via any OpenAI-compatible endpoint with graceful offline fallback." },
      { type: "feat", message: "CLI (uba): init, demo, track, import, analyze, report, clear; deterministic demo data generator." },
    ],
  },
];
