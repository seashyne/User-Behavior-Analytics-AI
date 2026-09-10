/**
 * Rule-based insight engine.
 *
 * Translates raw analysis numbers into prioritized, human-readable findings
 * with severity levels. This runs fully offline and deterministic; the LLM
 * narrative layer (ai.ts) sits on top of these insights, not instead of them.
 */
import type { AnalysisReport, Insight } from "./types.ts";

/** Humanize milliseconds as a compact duration string. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/**
 * Generate insights from a partially filled report (overview, retention,
 * funnel, anomalies, segments). Each rule is independent and only fires
 * when there is enough data for it to be meaningful.
 */
export function generateInsights(report: AnalysisReport): Insight[] {
  const insights: Insight[] = [];
  const { overview, retention, funnel, anomalies, segments } = report;

  if (overview.totalEvents === 0) {
    insights.push({
      severity: "info",
      category: "engagement",
      title: "No data yet",
      detail: "Track some events (client.track or `uba demo`) to unlock behavioral insights.",
    });
    return insights;
  }

  // Engagement depth: events per session below 2 suggests visits are shallow.
  if (overview.avgEventsPerSession < 2 && overview.totalSessions >= 10) {
    insights.push({
      severity: "warning",
      category: "engagement",
      title: "Shallow sessions",
      detail: `Users average only ${overview.avgEventsPerSession.toFixed(1)} events per session. Consider improving onboarding or content discovery to deepen engagement.`,
    });
  } else if (overview.avgEventsPerSession >= 5) {
    insights.push({
      severity: "info",
      category: "engagement",
      title: "High engagement depth",
      detail: `Sessions average ${overview.avgEventsPerSession.toFixed(1)} events, indicating strong interaction depth (avg duration ${formatDuration(overview.avgSessionDurationMs)}).`,
    });
  }

  // Funnel: flag the worst drop-off step and celebrate strong conversion.
  if (funnel && funnel.steps.length > 1 && funnel.dropoffStep) {
    const step = funnel.steps.find((s) => s.event === funnel.dropoffStep);
    if (step && step.conversionFromPrevious !== null && step.conversionFromPrevious < 0.5) {
      insights.push({
        severity: step.conversionFromPrevious < 0.3 ? "critical" : "warning",
        category: "funnel",
        title: `Biggest drop-off at "${step.event}"`,
        detail: `Only ${pct(step.conversionFromPrevious)} of users who reached the previous step continue to "${step.event}". Overall funnel conversion is ${pct(funnel.overallConversion)}.`,
      });
    } else if (funnel.overallConversion >= 0.5) {
      insights.push({
        severity: "info",
        category: "funnel",
        title: "Healthy funnel",
        detail: `Overall conversion through ${funnel.steps.map((s) => s.event).join(" -> ")} is ${pct(funnel.overallConversion)}.`,
      });
    }
  }

  // Retention: day-1 and day-7 benchmarks against common product baselines.
  const day1 = retention.find((r) => r.day === 1);
  const day7 = retention.find((r) => r.day === 7);
  if (day1 && day1.cohortSize >= 10) {
    if (day1.rate < 0.2) {
      insights.push({
        severity: "critical",
        category: "retention",
        title: "Weak day-1 retention",
        detail: `Only ${pct(day1.rate)} of users return the day after their first visit. First-run experience is the most likely culprit.`,
      });
    } else {
      insights.push({
        severity: "info",
        category: "retention",
        title: "Day-1 retention",
        detail: `${pct(day1.rate)} of users come back the next day${day7 ? `, and ${pct(day7.rate)} return after 7 days` : ""}.`,
      });
    }
  }

  // Anomalies: surface the most extreme deviation first.
  if (anomalies.length > 0) {
    const worst = [...anomalies].sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))[0]!;
    insights.push({
      severity: Math.abs(worst.zScore) >= 3 ? "critical" : "warning",
      category: "anomaly",
      title: `${worst.direction === "spike" ? "Spike" : "Drop"} in ${worst.metric} on ${worst.date}`,
      detail: `Value ${worst.value} vs mean ${worst.mean.toFixed(1)} (z-score ${worst.zScore.toFixed(2)}). ${anomalies.length} anomalous day-metric(s) detected in total.`,
    });
  }

  // Segmentation: warn when a large share of users lands in the low-engagement cluster.
  const atRisk = segments.find((s) => s.label === "Casual / At-Risk Users");
  if (atRisk && overview.totalUsers > 0 && atRisk.userCount / overview.totalUsers > 0.5) {
    insights.push({
      severity: "warning",
      category: "segmentation",
      title: "Majority of users are low-engagement",
      detail: `${pct(atRisk.userCount / overview.totalUsers)} of users (${atRisk.userCount}/${overview.totalUsers}) fall into the Casual / At-Risk segment (avg ${atRisk.centroid["sessionCount"]?.toFixed(1) ?? "?"} sessions, ${atRisk.centroid["activeDays"]?.toFixed(1) ?? "?"} active days).`,
    });
  }
  const power = segments.find((s) => s.label === "Power Users");
  if (power && power.userCount > 0) {
    insights.push({
      severity: "info",
      category: "segmentation",
      title: "Power user base identified",
      detail: `${power.userCount} power users average ${power.centroid["eventCount"]?.toFixed(0) ?? "?"} events across ${power.centroid["activeDays"]?.toFixed(1) ?? "?"} active days. Study their behavior paths to replicate what works.`,
    });
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}
