/**
 * Event store: the ingestion front-door on top of the pluggable storage
 * layer. Handles id/timestamp generation, config persistence, and backend
 * selection, while storage.ts owns the actual bytes on disk.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveConfig, type UBAConfig } from "./config.ts";
import { createStorage, type EventStorage } from "./storage.ts";
import { migrateJsonlConfigVersion } from "./schema.ts";
import type { TrackInput, UBAEvent } from "./types.ts";

export { DEFAULT_CONFIG } from "./config.ts";
export type { UBAConfig, StorageConfig, AIConfig } from "./config.ts";

/**
 * The main entry point for ingesting and reading events.
 * Create one directly or through the high-level createUBAClient().
 */
export class EventStore {
  readonly config: UBAConfig;
  /** Active persistence backend (jsonl or sqlite), chosen from config. */
  readonly storage: EventStorage;
  private readonly configPath: string;

  constructor(config: Partial<UBAConfig> = {}) {
    this.config = resolveConfig(config);
    this.config.dataDir = resolve(this.config.dataDir);
    this.configPath = join(this.config.dataDir, "uba.config.json");
    this.storage = createStorage(this.config.dataDir, this.config.storage.backend, this.config.storage.sqliteFile);
  }

  /** Create the data directory, persist config, and initialize storage. */
  init(): void {
    mkdirSync(this.config.dataDir, { recursive: true });
    // Upgrade the JSONL schema marker (config-based; SQLite stamps its own
    // version via PRAGMA inside migrateSqlite when the backend opens).
    this.config.schemaVersion = migrateJsonlConfigVersion(this.config.schemaVersion).to;
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
    this.storage.init();
  }

  /**
   * Load the persisted config from a data directory if present, so CLI
   * invocations reuse the settings chosen at `uba init` time. Missing or
   * unknown fields fall back to defaults via resolveConfig.
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
    this.storage.append(event);
    return event;
  }

  /** Append many events in one batched write (used by import and demo). */
  trackBatch(inputs: TrackInput[]): UBAEvent[] {
    const events: UBAEvent[] = inputs.map((input) => ({
      id: input.id ?? randomUUID(),
      userId: input.userId,
      event: input.event,
      timestamp: input.timestamp ?? Date.now(),
      ...(input.properties ? { properties: input.properties } : {}),
    }));
    this.storage.appendMany(events);
    return events;
  }

  /** Read every stored event, ordered by timestamp. */
  readAll(): UBAEvent[] {
    return this.storage.readAll();
  }

  /** Delete all stored events (keeps config). Mostly useful in tests. */
  clear(): void {
    this.storage.clear();
  }

  /** Release storage resources (closes the SQLite handle when in use). */
  close(): void {
    this.storage.close();
  }
}
