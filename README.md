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
uba.init();

// Track events anywhere in your app.
uba.track({ userId: "u1", event: "signup", properties: { plan: "pro" } });
uba.track({ userId: "u1", event: "checkout_start" });

// Full analysis: sessions, funnel, retention, anomalies, segments, insights.
const report = uba.analyze();
console.log(report.insights);

// Narrative report (LLM when configured, offline template otherwise).
const { narrative } = await uba.report();
console.log(narrative);
```

## What you get

| Layer | What it does |
| --- | --- |
| Sessionizer | Groups events into sessions with a 30-min inactivity gap (configurable). |
| Metrics | Overview totals, top events, daily activity, ordered funnels, day-N retention. |
| Anomaly detection | Robust z-scores over daily volume and DAU series; flags spikes and drops. |
| Segmentation | k-means over normalized per-user features, labeled Power / Regular / Casual-At-Risk. Deterministic (seeded), so repeated runs give stable segments. |
| Insight engine | Rule-based findings with severity (info / warning / critical) - works fully offline. |
| AI narrative | Optional LLM report via any OpenAI-compatible endpoint; falls back to the offline narrative automatically. |

## CLI commands

```
uba init                          Create ./uba-data with default config
uba demo [--users N] [--days N]   Generate a synthetic demo dataset
uba track <event> --user <id>     Record one event (--props '{"a":1}' optional)
uba import <file.json>            Import an array of events from a JSON file
uba analyze [--funnel a,b,c]      Full analysis (--json for machine output)
uba report [--ai]                 Narrative report
uba clear                         Delete all stored events
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

## Library API

```ts
import {
  createUBAClient,      // high-level client (recommended)
  EventStore,           // raw JSONL persistence
  sessionize,           // events -> sessions
  computeOverview, computeFunnel, computeRetention,
  detectAnomalies,      // z-score anomalies on daily series
  segmentUsers,         // k-means behavioral segments
  generateInsights,     // rule-based findings
  generateNarrative,    // offline/LLM narrative
} from "uba-ai";
```

Client options: `dataDir`, `sessionTimeoutMs`, `segmentCount`, `anomalyZThreshold`, `funnelSteps`, `retentionDays`, `ai: { baseUrl, model, apiKeyEnv }`.

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
