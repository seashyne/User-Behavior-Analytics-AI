#!/usr/bin/env node
/**
 * uba CLI - the zero-setup entry point.
 *
 * Commands:
 *   uba init                       create ./uba-data with default config
 *   uba demo [--users N] [--days N] generate a synthetic dataset
 *   uba track <event> --user <id> [--props '{"key":"value"}']
 *   uba import <file.json>         import an array of events
 *   uba analyze [--funnel a,b,c] [--json]
 *   uba report [--ai] [--json]     narrative report (LLM when configured)
 *   uba clear                      delete all stored events
 *
 * Global flag: --dir <path> to use a data directory other than ./uba-data.
 */
import { readFileSync } from "node:fs";
import { EventStore } from "./store.ts";
import { UBAClient } from "./index.ts";
import { generateDemoEvents } from "./demo.ts";
import { buildOfflineNarrative } from "./ai.ts";
import { viewEvent, CONTENT_TIME_EVENT } from "./content.ts";
import { formatDuration } from "./insights.ts";
import { version as pkgVersion, patchUpdates } from "./version.ts";
import type { AnalysisReport, TrackInput } from "./types.ts";

/** Minimal flag parser: returns positional args plus --key value pairs. */
function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

const HELP = `uba-ai - User Behavior Analytics AI (v${pkgVersion})

Usage:
  uba init                          Create ./uba-data with default config
  uba demo [--users N] [--days N]   Generate a synthetic demo dataset
  uba track <event> --user <id>     Record one event (--props '{"a":1}' optional)
  uba view <contentId> --user <id>  Record a content view (what the user is looking at)
                                    [--type page|article|image|video] [--title "..."]
                                    [--url "..."] [--dwell 45000] (ms on content)
  uba import <file.json>            Import an array of events from a JSON file
  uba analyze [--funnel a,b,c]      Run full analysis (--json for machine output)
  uba report [--ai]                 Print narrative report (--ai forces LLM mode)
  uba clear                         Delete all stored events
  uba version                       Show version and patch update history

Global flags:
  --dir <path>   Data directory (default: ./uba-data or saved config)
  --json         Machine-readable output for analyze/report

Storage & config:
  All settings live in <dataDir>/uba.config.json with built-in defaults, so
  nothing must be configured. To switch persistence from the default JSONL
  file to SQL, set:  "storage": { "backend": "sqlite" }  (uses Node's built-in
  node:sqlite, requires Node >= 22.5, database file: uba-data/uba.sqlite).

AI narrative (optional):
  Set UBA_AI_API_KEY to enable LLM reports against any OpenAI-compatible API.
  Optional: UBA_AI_BASE_URL (default https://api.openai.com/v1), UBA_AI_MODEL
  (default gpt-4o-mini). Without a key, reports use the built-in offline engine.
`;

/** Pretty-print the analysis report as aligned human-readable text. */
function printAnalysis(report: AnalysisReport, funnelSteps: string[]): void {
  const { overview, retention, funnel, anomalies, segments, insights } = report;
  const line = (s = ""): void => { console.log(s); };

  if (overview.totalEvents === 0) {
    line("No events yet. Try: uba demo  (or: uba track page_view --user u1)");
    return;
  }

  line("OVERVIEW");
  line(`  Events:   ${overview.totalEvents}`);
  line(`  Users:    ${overview.totalUsers}`);
  line(`  Sessions: ${overview.totalSessions}`);
  const mins = overview.avgSessionDurationMs / 60000;
  line(`  Avg session: ${mins.toFixed(1)} min, ${overview.avgEventsPerSession.toFixed(1)} events/session`);
  line(`  Top events: ${overview.topEvents.slice(0, 5).map((e) => `${e.event} (${e.count})`).join(", ")}`);
  line();

  if (funnel) {
    line("FUNNEL");
    for (const step of funnel.steps) {
      const conv = step.conversionFromPrevious === null ? "" : ` (${(step.conversionFromPrevious * 100).toFixed(1)}% from prev)`;
      line(`  ${step.event}: ${step.reachedUsers} users${conv}`);
    }
    line(`  Overall conversion: ${(funnel.overallConversion * 100).toFixed(1)}%`);
    if (funnel.dropoffStep) line(`  Biggest drop-off at: ${funnel.dropoffStep}`);
    line();
  } else if (funnelSteps.length === 0) {
    line("FUNNEL  (skipped - pass --funnel signup,checkout_start,purchase)");
    line();
  }

  if (retention.length > 0) {
    line("RETENTION (day-N return rate)");
    line(`  ${retention.map((r) => `d${r.day}: ${(r.rate * 100).toFixed(0)}%`).join("  ")}`);
    line();
  }

  if (anomalies.length > 0) {
    line("ANOMALIES");
    for (const a of anomalies) {
      line(`  ${a.date}  ${a.metric} ${a.direction}: ${a.value} vs mean ${a.mean.toFixed(1)} (z=${a.zScore.toFixed(2)})`);
    }
    line();
  }

  if (segments.length > 0) {
    line("SEGMENTS");
    for (const seg of segments) {
      line(`  ${seg.label}: ${seg.userCount} users (avg ${(seg.centroid["eventCount"] ?? 0).toFixed(0)} events, ${(seg.centroid["sessionCount"] ?? 0).toFixed(1)} sessions, ${(seg.centroid["activeDays"] ?? 0).toFixed(1)} active days)`);
    }
    line();
  }

  if (report.content && report.content.topContent.length > 0) {
    line("CONTENT ENGAGEMENT (what users look at, and for how long)");
    for (const item of report.content.topContent.slice(0, 8)) {
      const label = item.title ?? item.contentId;
      const dwell = item.totalDwellMs > 0 ? `, ${formatDuration(item.totalDwellMs)} dwell` : "";
      line(`  ${label} (${item.contentType}): ${item.views} views, ${item.uniqueViewers} viewers${dwell}`);
    }
    line();
  }

  line("INSIGHTS");
  if (insights.length === 0) line("  Nothing notable - all metrics within normal ranges.");
  for (const i of insights) {
    line(`  [${i.severity.toUpperCase()}] ${i.title}`);
    line(`      ${i.detail}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];

  if (!command || command === "help" || flags["help"] === true) {
    console.log(HELP);
    return;
  }

  const dataDir = typeof flags["dir"] === "string" ? flags["dir"] : "uba-data";
  // Load persisted uba.config.json (if any) so CLI runs honor the user's
  // storage backend and analysis settings instead of silently using defaults.
  const client = new UBAClient(EventStore.loadFrom(dataDir).config);
  const store = client.store;

  switch (command) {
    case "init": {
      store.init();
      console.log(`Initialized uba-ai in ${store.config.dataDir}`);
      console.log("Next: uba demo  (synthetic data)  or  uba track page_view --user u1");
      break;
    }

    case "demo": {
      const users = Number(flags["users"] ?? 60);
      const days = Number(flags["days"] ?? 14);
      const demoEvents = generateDemoEvents({ users, days });
      store.init();
      store.trackBatch(demoEvents);
      console.log(`Generated ${demoEvents.length} demo events for ${users} users over ${days} days.`);
      console.log("Run: uba analyze --funnel signup,checkout_start,purchase   or   uba report");
      break;
    }

    case "track": {
      const eventName = positionals[1];
      const userId = typeof flags["user"] === "string" ? flags["user"] : undefined;
      if (!eventName || !userId) {
        console.error("Usage: uba track <event> --user <id> [--props '{\"key\":\"value\"}']");
        process.exitCode = 1;
        break;
      }
      let properties: Record<string, unknown> | undefined;
      if (typeof flags["props"] === "string") {
        try {
          properties = JSON.parse(flags["props"]) as Record<string, unknown>;
        } catch {
          console.error("--props must be valid JSON, e.g. --props '{\"page\":\"/home\"}'");
          process.exitCode = 1;
          break;
        }
      }
      const event = store.track({ userId, event: eventName, ...(properties ? { properties } : {}) });
      console.log(`Tracked ${event.event} for ${event.userId} (${event.id})`);
      break;
    }

    case "import": {
      const file = positionals[1];
      if (!file) {
        console.error("Usage: uba import <file.json>  (JSON array of {userId, event, timestamp?, properties?})");
        process.exitCode = 1;
        break;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        console.error(`Failed to read ${file}: ${(err as Error).message}`);
        process.exitCode = 1;
        break;
      }
      if (!Array.isArray(parsed)) {
        console.error("Import file must contain a JSON array of events.");
        process.exitCode = 1;
        break;
      }
      const inputs: TrackInput[] = parsed.map((raw) => {
        const item = raw as Partial<TrackInput>;
        if (!item.userId || !item.event) {
          throw new Error("Every event needs at least userId and event fields");
        }
        return {
          userId: item.userId,
          event: item.event,
          ...(item.timestamp !== undefined ? { timestamp: item.timestamp } : {}),
          ...(item.properties ? { properties: item.properties } : {}),
        };
      });
      store.init();
      store.trackBatch(inputs);
      console.log(`Imported ${inputs.length} events from ${file}`);
      break;
    }

    case "analyze": {
      const funnelSteps = typeof flags["funnel"] === "string" ? flags["funnel"].split(",").map((s) => s.trim()).filter(Boolean) : [];
      const report = client.analyze(funnelSteps);
      if (flags["json"] === true) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printAnalysis(report, funnelSteps);
      }
      break;
    }

    case "report": {
      const funnelSteps = typeof flags["funnel"] === "string" ? flags["funnel"].split(",").map((s) => s.trim()).filter(Boolean) : [];
      const report = client.analyze(funnelSteps);
      if (flags["ai"] === true) {
        // --ai forces an LLM attempt; generateNarrative still falls back offline.
        const { generateNarrative } = await import("./ai.ts");
        const cfg = store.config.ai;
        const narrative = await generateNarrative(report, {
          useLLM: true,
          ...(cfg ? { baseUrl: cfg.baseUrl, model: cfg.model, apiKeyEnv: cfg.apiKeyEnv } : {}),
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify({ source: narrative.source, narrative: narrative.text }, null, 2));
        } else {
          console.log(narrative.text);
          console.log(`\n[source: ${narrative.source}]`);
        }
      } else if (flags["json"] === true) {
        const narrative = buildOfflineNarrative(report);
        console.log(JSON.stringify({ source: "offline", narrative }, null, 2));
      } else {
        console.log(buildOfflineNarrative(report));
      }
      break;
    }

    case "view": {
      // Record what a user is looking at: uba view <contentId> --user <id>
      // [--type page|article|image|video] [--title "..."] [--url "..."] [--dwell ms]
      const contentId = positionals[1];
      const userId = typeof flags["user"] === "string" ? flags["user"] : undefined;
      if (!contentId || !userId) {
        console.error('Usage: uba view <contentId> --user <id> [--type article] [--title "..."] [--url "..."] [--dwell 45000]');
        process.exitCode = 1;
        break;
      }
      const contentType = typeof flags["type"] === "string" ? flags["type"] : "page";
      const title = typeof flags["title"] === "string" ? flags["title"] : undefined;
      const url = typeof flags["url"] === "string" ? flags["url"] : undefined;
      const now = Date.now();
      const view = {
        contentType,
        contentId,
        ...(title !== undefined ? { title } : {}),
        ...(url !== undefined ? { url } : {}),
      };
      store.track(viewEvent(userId, view, now));
      // --dwell also records the paired content_time event with elapsed ms.
      const dwell = flags["dwell"];
      if (typeof dwell === "string") {
        const dwellMs = Number(dwell);
        if (!Number.isFinite(dwellMs) || dwellMs < 0) {
          console.error("--dwell must be a non-negative number of milliseconds, e.g. --dwell 45000");
          process.exitCode = 1;
          break;
        }
        store.track({
          userId,
          event: CONTENT_TIME_EVENT,
          timestamp: now + dwellMs,
          properties: { contentType, contentId, ...(title !== undefined ? { title } : {}), dwellMs },
        });
        console.log(`Viewed ${contentType} "${contentId}" for ${dwellMs}ms as ${userId}`);
      } else {
        console.log(`Viewed ${contentType} "${contentId}" as ${userId}`);
      }
      break;
    }

    case "version": {
      console.log(`uba-ai v${pkgVersion}`);
      for (const record of patchUpdates) {
        console.log(`\n${record.version} (${record.date})`);
        for (const update of record.patchUpdates) {
          console.log(`  [${update.type}] ${update.message}`);
        }
      }
      break;
    }

    case "clear": {
      store.clear();
      console.log("Cleared all stored events (config kept).");
      break;
    }

    default: {
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(`uba-ai error: ${(err as Error).message}`);
  process.exitCode = 1;
});
