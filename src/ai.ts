/**
 * AI narrative layer.
 *
 * Two modes:
 * 1. Offline (default): a deterministic template narrative assembled from
 *    the rule-based insights, so the package works with zero setup.
 * 2. LLM mode: when an API key env var is set, the analysis JSON is sent to
 *    any OpenAI-compatible chat completions endpoint (OpenAI, OpenRouter,
 *    Cloudflare Workers AI, Ollama, ...) for a natural-language report.
 *    Uses global fetch, so no HTTP dependency is needed.
 */
import type { AnalysisReport } from "./types.ts";
import { formatDuration } from "./insights.ts";

/** Options accepted by generateNarrative(). */
export interface NarrativeOptions {
  /** Force LLM mode on/off. Default: on when the configured API key env var is set. */
  useLLM?: boolean;
  /** OpenAI-compatible base URL. Default: https://api.openai.com/v1 */
  baseUrl?: string;
  /** Chat model name. Default: gpt-4o-mini */
  model?: string;
  /** Env var holding the API key. Default: UBA_AI_API_KEY */
  apiKeyEnv?: string;
  /** Abort timeout for the LLM request in ms. Default: 60000 */
  timeoutMs?: number;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Build the offline template narrative from the analysis report. */
export function buildOfflineNarrative(report: AnalysisReport): string {
  const { overview, retention, funnel, segments, insights } = report;
  const lines: string[] = [];
  lines.push("USER BEHAVIOR ANALYTICS REPORT");
  lines.push("==============================");
  lines.push("");

  if (overview.totalEvents === 0) {
    lines.push("No events recorded yet. Run `uba demo` or track events to get started.");
    return lines.join("\n");
  }

  lines.push("OVERVIEW");
  lines.push(`- ${overview.totalEvents} events from ${overview.totalUsers} users across ${overview.totalSessions} sessions`);
  lines.push(`- Avg session: ${formatDuration(overview.avgSessionDurationMs)} with ${overview.avgEventsPerSession.toFixed(1)} events`);
  if (overview.firstEventAt && overview.lastEventAt) {
    lines.push(`- Data range: ${new Date(overview.firstEventAt).toISOString().slice(0, 10)} to ${new Date(overview.lastEventAt).toISOString().slice(0, 10)}`);
  }
  const top = overview.topEvents.slice(0, 5).map((e) => `${e.event} (${e.count})`).join(", ");
  if (top) lines.push(`- Top events: ${top}`);
  lines.push("");

  if (funnel && funnel.steps.length > 0) {
    lines.push("FUNNEL");
    for (const step of funnel.steps) {
      const conv = step.conversionFromPrevious === null ? "-" : pct(step.conversionFromPrevious);
      lines.push(`- ${step.event}: ${step.reachedUsers} users (step conversion ${conv})`);
    }
    lines.push(`- Overall conversion: ${pct(funnel.overallConversion)}`);
    lines.push("");
  }

  if (retention.length > 0) {
    lines.push("RETENTION");
    lines.push(`- ${retention.map((r) => `day-${r.day}: ${pct(r.rate)}`).join(", ")}`);
    lines.push("");
  }

  if (segments.length > 0) {
    lines.push("SEGMENTS");
    for (const seg of segments) {
      lines.push(`- ${seg.label}: ${seg.userCount} users (avg ${seg.centroid["eventCount"]?.toFixed(0) ?? 0} events, ${seg.centroid["sessionCount"]?.toFixed(1) ?? 0} sessions)`);
    }
    lines.push("");
  }

  if (report.content && report.content.topContent.length > 0) {
    lines.push("CONTENT ENGAGEMENT (what users look at, and for how long)");
    for (const item of report.content.topContent.slice(0, 5)) {
      const label = item.title ?? item.contentId;
      const dwell = item.totalDwellMs > 0 ? `, ${formatDuration(item.totalDwellMs)} total dwell` : "";
      lines.push(`- ${label} (${item.contentType}): ${item.views} views, ${item.uniqueViewers} viewers${dwell}`);
    }
    lines.push("");
  }

  lines.push("KEY INSIGHTS");
  if (insights.length === 0) {
    lines.push("- No notable findings; metrics are within normal ranges.");
  } else {
    for (const insight of insights) {
      lines.push(`- [${insight.severity.toUpperCase()}] ${insight.title}: ${insight.detail}`);
    }
  }
  return lines.join("\n");
}

/** Compact the report before sending to an LLM to keep token usage sane. */
function compactForLLM(report: AnalysisReport): unknown {
  return {
    overview: {
      ...report.overview,
      topEvents: report.overview.topEvents.slice(0, 10),
      dailyActivity: report.overview.dailyActivity.slice(-30),
    },
    retention: report.retention,
    funnel: report.funnel,
    anomalies: report.anomalies.slice(0, 10),
    segments: report.segments.map((s) => ({ label: s.label, userCount: s.userCount, centroid: s.centroid })),
    content: report.content
      ? {
          totalViews: report.content.totalViews,
          totalDwellMs: report.content.totalDwellMs,
          byType: report.content.byType,
          topContent: report.content.topContent.slice(0, 10),
        }
      : null,
    insights: report.insights,
  };
}

/**
 * Generate a narrative report for the analysis.
 * Falls back to the offline narrative whenever LLM mode is unavailable
 * (no API key, request failure, timeout), so callers always get a report.
 */
export async function generateNarrative(report: AnalysisReport, options: NarrativeOptions = {}): Promise<{ text: string; source: "llm" | "offline" }> {
  const apiKeyEnv = options.apiKeyEnv ?? "UBA_AI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  const wantLLM = options.useLLM ?? Boolean(apiKey);
  if (!wantLLM || !apiKey) {
    return { text: buildOfflineNarrative(report), source: "offline" };
  }

  const baseUrl = (options.baseUrl ?? process.env["UBA_AI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model ?? process.env["UBA_AI_MODEL"] ?? "gpt-4o-mini";
  const timeoutMs = options.timeoutMs ?? 60000;

  const systemPrompt =
    "You are a senior product analytics expert. Given a JSON user behavior analysis " +
    "(overview metrics, funnel, retention, anomalies, segments, rule-based insights), " +
    "write a concise executive report: what is happening, what is concerning, and " +
    "the top 3 recommended actions. Plain text, no markdown headers, no emojis.";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(compactForLLM(report)) },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("LLM returned an empty response");
    return { text, source: "llm" };
  } catch {
    // Any LLM failure degrades gracefully to the deterministic narrative.
    return { text: buildOfflineNarrative(report), source: "offline" };
  }
}
