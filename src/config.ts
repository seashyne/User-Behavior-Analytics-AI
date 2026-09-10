/**
 * Configuration layer for uba-ai.
 *
 * All user-tunable settings live in one JSON file (uba.config.json inside
 * the data directory). Every section has built-in defaults so a fresh
 * install works with zero configuration; users override only what they need
 * either programmatically or by editing the JSON file directly.
 */

/** Storage backend selection. */
export interface StorageConfig {
  /** "jsonl" (append-only text file) or "sqlite" (node:sqlite, Node >= 22.5). */
  backend: "jsonl" | "sqlite";
  /** SQLite database file name inside dataDir (backend "sqlite" only). */
  sqliteFile: string;
}

/** Optional LLM narrative settings (OpenAI-compatible endpoints). */
export interface AIConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
}

/** Runtime configuration persisted in uba.config.json inside the data dir. */
export interface UBAConfig {
  /** Directory holding all persisted files. */
  dataDir: string;
  /** Inactivity gap (ms) that closes a session. Default: 30 minutes. */
  sessionTimeoutMs: number;
  /** Number of behavioral segments for k-means. Default: 3. */
  segmentCount: number;
  /** Z-score threshold above which a daily count is an anomaly. Default: 2. */
  anomalyZThreshold: number;
  /** Where and how events are persisted. Default: JSONL file. */
  storage: StorageConfig;
  /** Optional OpenAI-compatible endpoint for AI narrative reports. */
  ai?: AIConfig;
}

/** Built-in defaults applied for every field the user does not set. */
export const DEFAULT_CONFIG: UBAConfig = {
  dataDir: "uba-data",
  sessionTimeoutMs: 30 * 60 * 1000,
  segmentCount: 3,
  anomalyZThreshold: 2,
  storage: { backend: "jsonl", sqliteFile: "uba.sqlite" },
};

/**
 * Deep-merge a partial user config over the defaults.
 * Nested sections (storage, ai) merge field-by-field so setting only
 * storage.backend keeps the default sqliteFile, matching how users expect
 * a JSON config file to behave.
 */
export function resolveConfig(user: Partial<UBAConfig> = {}): UBAConfig {
  const merged: UBAConfig = {
    ...DEFAULT_CONFIG,
    ...user,
    storage: { ...DEFAULT_CONFIG.storage, ...user.storage },
  };
  if (user.ai) merged.ai = { ...user.ai };
  return merged;
}
