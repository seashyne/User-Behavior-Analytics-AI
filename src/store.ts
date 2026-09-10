/**
 * Event store backed by an append-only JSONL file.
 *
 * Chosen for zero-dependency portability: a user can `npm i uba-ai` and
 * immediately persist events to ./uba-data/events.jsonl without any
 * database setup. The store is the single source of truth consumed by
 * the sessionizer and all analysis layers.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { TrackInput, UBAConfig, UBAEvent } from "./types.ts";

/** Sensible defaults applied when no config file exists yet. */
export const DEFAULT_CONFIG: UBAConfig = {
  dataDir: "uba-data",
  sessionTimeoutMs: 30 * 60 * 1000,
  segmentCount: 3,
  anomalyZThreshold: 2,
};

/**
 * The main entry point for ingesting and reading events.
 * Create one with createStore() or the high-level createUBAClient().
 */
export class EventStore {
  readonly config: UBAConfig;
  private readonly eventsPath: string;
  private readonly configPath: string;

  constructor(config: Partial<UBAConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.config.dataDir = resolve(this.config.dataDir);
    this.eventsPath = join(this.config.dataDir, "events.jsonl");
    this.configPath = join(this.config.dataDir, "uba.config.json");
  }

  /** Create the data directory and persist the resolved config. Idempotent. */
  init(): void {
    mkdirSync(this.config.dataDir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
  }

  /**
   * Load the persisted config from a data directory if present, so CLI
   * invocations reuse the settings chosen at `uba init` time.
   */
  static loadFrom(dataDir: string): EventStore {
    const configPath = join(resolve(dataDir), "uba.config.json");
    if (existsSync(configPath)) {
      try {
        const saved = JSON.parse(readFileSync(configPath, "utf8")) as Partial<UBAConfig>;
        return new EventStore({ ...saved, dataDir });
      } catch {
        // Corrupt config falls back to defaults rather than breaking analysis.
      }
    }
    return new EventStore({ dataDir });
  }

  /** Append one event, generating id/timestamp when not supplied. */
  track(input: TrackInput): UBAEvent {
    const event: UBAEvent = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      event: input.event,
      timestamp: input.timestamp ?? Date.now(),
      ...(input.properties ? { properties: input.properties } : {}),
    };
    mkdirSync(this.config.dataDir, { recursive: true });
    appendFileSync(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  /** Append many events at once (used by import and demo generation). */
  trackBatch(inputs: TrackInput[]): UBAEvent[] {
    return inputs.map((input) => this.track(input));
  }

  /** Read every stored event, skipping malformed lines defensively. */
  readAll(): UBAEvent[] {
    if (!existsSync(this.eventsPath)) return [];
    const lines = readFileSync(this.eventsPath, "utf8").split("\n");
    const events: UBAEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as UBAEvent);
      } catch {
        // Ignore corrupt lines: partial writes should not brick the dataset.
      }
    }
    return events;
  }

  /** Delete all stored events (keeps config). Mostly useful in tests. */
  clear(): void {
    if (existsSync(this.eventsPath)) writeFileSync(this.eventsPath, "", "utf8");
  }
}
