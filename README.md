# uba-ai

User Behavior Analytics AI for Node.js. Track user events, then get sessions, funnels, retention, anomaly detection, behavioral segmentation, and AI-generated insights - with zero dependencies and zero setup.

Install it and it just works:

```bash
npm install uba-ai
```

## Quick start (CLI)

```bash
npx uba demo                # generate a realistic synthetic dataset
npx uba analyze --funnel signup,checkout_start,purchase
npx uba report              # full narrative report
```

No API key, no database, no config. Data is stored in `./uba-data/events.jsonl` (plain JSON lines, easy to inspect or delete).

## Quick start (library)

```ts
import { createUBAClient } from "uba-ai";

const uba = createUBAClient({
  funnelSteps: ["signup", "checkout_start", "purchase"],
});
await uba.init();

// Track events anywhere in your app (async since v0.3.0).
await uba.track({ userId: "u1", event: "signup", properties: { plan: "pro" } });
await uba.track({ userId: "u1", event: "checkout_start" });

// Full analysis: sessions, funnel, retention, anomalies, segments, insights.
const report = await uba.analyze();
console.log(report.insights);

// Narrative report (LLM when configured, offline template otherwise).
const { narrative } = await uba.report();
console.log(narrative);

// Windowed analysis: only look at the last 7 days (pushed down to storage).
const weekly = await uba.analyze({ since: Date.now() - 7 * 24 * 3600 * 1000 });
```

**Migrating from v0.2?** Every storage-touching method is now async - add `await` in front of `init()`, `track()`, `trackBatch()`, `view()`, `events()`, `analyze()`, `clear()`, and `dwell.start()/stop()`. `analyze()` also accepts an options object: `analyze({ funnelSteps, since, until })`. See [CHANGELOG.md](CHANGELOG.md) for the full list.

## What you get

| Layer | What it does |
| --- | --- |
| Sessionizer | Groups events into sessions with a 30-min inactivity gap (configurable). |
| Metrics | Overview totals, top events, daily activity, ordered funnels, day-N retention. |
| Content tracking | Records what users are looking at (page/article/image/video) and for how long (dwell time). |
| Anomaly detection | Robust z-scores over daily volume and DAU series; flags spikes and drops. |
| Segmentation | k-means over normalized per-user features, labeled Power / Regular / Casual-At-Risk. Deterministic (seeded), so repeated runs give stable segments. |
| Insight engine | Rule-based findings with severity (info / warning / critical) - works fully offline. |
| AI narrative | Optional LLM report via any OpenAI-compatible endpoint; falls back to the offline narrative automatically. |
| Storage | Pluggable: default JSONL file, or SQL via Node's built-in node:sqlite. |

## CLI commands

```
uba init                          Create ./uba-data with default config
uba demo [--users N] [--days N]   Generate a synthetic demo dataset
uba track <event> --user <id>     Record one event (--props '{"a":1}' optional)
uba view <contentId> --user <id>  Record a content view: what the user is looking at
                                  [--type page|article|image|video] [--title "..."]
                                  [--url "..."] [--dwell 45000] (ms on content)
uba import <file.json>            Import an array of events from a JSON file
uba analyze [--funnel a,b,c]      Full analysis (--json for machine output)
uba report [--ai]                 Narrative report
uba clear                         Delete all stored events
uba version                       Show version and patch update history
```

Global flags: `--dir <path>` (data directory), `--json` (machine-readable output).

## AI narrative mode (optional)

The package is fully functional offline. To get LLM-written executive reports, set an API key for any OpenAI-compatible endpoint (OpenAI, OpenRouter, Cloudflare Workers AI, Ollama, ...):

```bash
# Windows (PowerShell)
$env:UBA_AI_API_KEY = "sk-..."
# macOS / Linux
export UBA_AI_API_KEY=sk-...

uba report --ai
```

Optional environment variables:

- `UBA_AI_BASE_URL` - default `https://api.openai.com/v1` (for Ollama use `http://localhost:11434/v1`)
- `UBA_AI_MODEL` - default `gpt-4o-mini`
- `UBA_AI_API_KEY` - default key env var name

If the LLM call fails or times out, `report` degrades gracefully to the offline narrative - you always get output.

## Storage: JSONL file or SQL

The default backend is a plain JSONL file - no setup at all. To store events in SQL instead, switch the backend in `uba-data/uba.config.json` (or pass it to `createUBAClient`):

```json
{
  "storage": { "backend": "sqlite" }
}
```

```ts
const uba = createUBAClient({ storage: { backend: "sqlite" } });
```

The SQLite backend uses Node's built-in `node:sqlite` module (requires Node >= 22.5), so there are still zero external dependencies. Events live in one indexed table (`events`) inside `uba-data/uba.sqlite`, written in transactions, and every analysis layer reads from it transparently. Every config field has a default - you only override the sections you care about.

## Content-level tracking: what is the user looking at?

Beyond generic events, uba-ai models content attention directly: which page / article / image / video a user is viewing, and how long they stay on it.

```ts
// One-shot: the user is looking at this right now.
await uba.view("u1", { contentType: "image", contentId: "hero.jpg", title: "Hero image" });

// Measured: start when the content becomes visible, stop when it goes away.
const dwell = uba.watch("u1", { contentType: "article", contentId: "/blog/deep-dive", title: "Deep Dive" });
await dwell.start();           // records content_view
// ... user reads for 2 minutes ...
await dwell.stop();            // records content_time with dwellMs = 120000
```

In a browser, wire `start()`/`stop()` to IntersectionObserver, route changes, or `visibilitychange`; on a server or in scripts, call them around the interaction. `stop(ts, visibleRatio)` also accepts the observed visibility ratio to distinguish a glance from a full read.

From the CLI:

```bash
uba view /blog/deep-dive --user u1 --type article --title "Deep Dive" --dwell 120000
```

Analysis rolls this up automatically (`report.content`): top content by total dwell time, unique viewers, and per-type engagement (article vs image vs page), included in `uba analyze`, the narrative report, and the AI insights.

Honest scope note: uba-ai records what your code tells it. It cannot see a user's screen or know they are reading a specific paragraph unless you emit an event for it - the content API is the convention that makes "what are they looking at, and for how long" a first-class question instead of ad-hoc properties.

## Library API

```ts
import {
  createUBAClient,      // high-level client (recommended)
  EventStore,           // raw event persistence (jsonl or sqlite)
  JsonlStorage, SqliteStorage, createStorage, // pluggable backends
  resolveConfig, DEFAULT_CONFIG,              // sectioned config with defaults
  sessionize,           // events -> sessions
  computeOverview, computeFunnel, computeRetention,
  detectAnomalies,      // z-score anomalies on daily series
  segmentUsers,         // k-means behavioral segments
  computeContentEngagement, DwellTracker, viewEvent, // content attention layer
  generateInsights,     // rule-based findings
  generateNarrative,    // offline/LLM narrative
  version, patchUpdates, // active version + release history
} from "uba-ai";
```

Client options: `dataDir`, `sessionTimeoutMs`, `segmentCount`, `anomalyZThreshold`, `storage: { backend: "jsonl" | "sqlite", sqliteFile }`, `ai: { baseUrl, model, apiKeyEnv }`, `funnelSteps`, `retentionDays`. Client methods (all async since v0.3.0): `init`, `track`, `trackBatch`, `view`, `watch` (DwellTracker), `events` (optional `ReadRange`), `analyze` (options or funnel steps), `report`, `clear`, `close`.

## Importing existing data

`uba import events.json` accepts a JSON array where each item has at least `userId` and `event`, plus optional `timestamp` (epoch ms; defaults to now) and `properties`:

```json
[
  { "userId": "u1", "event": "page_view", "timestamp": 1767225600000, "properties": { "page": "/home" } },
  { "userId": "u1", "event": "signup" }
]
```

## Development

```bash
npm install
npm run build     # tsc -> dist/
npm test          # node --test (runs the TypeScript tests directly)
npm run demo      # build + generate demo data + print report
```

Requirements: Node.js >= 20. TypeScript strict mode, zero runtime dependencies.

## License

MIT
