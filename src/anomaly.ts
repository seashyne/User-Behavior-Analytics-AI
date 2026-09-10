/**
 * Anomaly detection over daily metric series using robust z-scores.
 *
 * Intentionally statistical rather than model-based: it runs instantly with
 * zero dependencies, explains itself (mean/std/z), and works on the small
 * series typical of daily event counts. Both spikes and drops are flagged
 * because a sudden collapse in activity is often more urgent than a surge.
 */
import type { Anomaly, OverviewMetrics } from "./types.ts";

/** Mean of a numeric array; 0 for empty input. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation of a numeric array. */
function stdDev(values: number[], mu: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Fill missing dates between first and last activity with zero counts so a
 * completely silent day is detectable as a drop instead of being invisible.
 */
function densifySeries(series: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  if (series.length === 0) return [];
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: Array<{ date: string; value: number }> = [];
  const byDate = new Map(sorted.map((p) => [p.date, p.value]));
  const cursor = new Date(sorted[0]!.date + "T00:00:00");
  const last = new Date(sorted[sorted.length - 1]!.date + "T00:00:00");
  while (cursor <= last) {
    const key = cursor.toISOString().slice(0, 10);
    // Use local-formatted keys consistently with metrics.dayKey output.
    const localKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    out.push({ date: localKey, value: byDate.get(localKey) ?? byDate.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Detect anomalous days in daily event volume and daily active users.
 * Needs at least 5 data points before flagging anything, otherwise the
 * z-score is meaningless noise on tiny series.
 */
export function detectAnomalies(overview: OverviewMetrics, zThreshold = 2): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const seriesList: Array<{ metric: string; points: Array<{ date: string; value: number }> }> = [
    { metric: "daily_events", points: densifySeries(overview.dailyActivity.map((d) => ({ date: d.date, value: d.events }))) },
    { metric: "daily_active_users", points: densifySeries(overview.dailyActivity.map((d) => ({ date: d.date, value: d.users }))) },
  ];

  for (const { metric, points } of seriesList) {
    if (points.length < 5) continue;
    const values = points.map((p) => p.value);
    const mu = mean(values);
    const sigma = stdDev(values, mu);
    // sigma === 0 means a perfectly flat series: nothing can be anomalous.
    if (sigma === 0) continue;
    for (const point of points) {
      const z = (point.value - mu) / sigma;
      if (Math.abs(z) >= zThreshold) {
        anomalies.push({
          date: point.date,
          metric,
          value: point.value,
          mean: mu,
          stdDev: sigma,
          zScore: z,
          direction: z > 0 ? "spike" : "drop",
        });
      }
    }
  }
  return anomalies;
}
