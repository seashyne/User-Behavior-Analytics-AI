/**
 * Metrics layer: turns sessions and events into the standard product
 * analytics numbers (overview, funnel, retention). Pure functions so they
 * can be unit-tested and reused by both the CLI and the library API.
 */
import type { FunnelResult, OverviewMetrics, RetentionPoint, Session, UBAEvent } from "./types.ts";

/** Format an epoch-ms timestamp as a local yyyy-mm-dd date key. */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Compute aggregate overview metrics over the full dataset. */
export function computeOverview(events: UBAEvent[], sessions: Session[]): OverviewMetrics {
  const eventCounts = new Map<string, number>();
  const daily = new Map<string, { events: number; users: Set<string> }>();
  const users = new Set<string>();
  let firstEventAt: number | null = null;
  let lastEventAt: number | null = null;

  for (const event of events) {
    users.add(event.userId);
    eventCounts.set(event.event, (eventCounts.get(event.event) ?? 0) + 1);
    const key = dayKey(event.timestamp);
    const bucket = daily.get(key) ?? { events: 0, users: new Set<string>() };
    bucket.events += 1;
    bucket.users.add(event.userId);
    daily.set(key, bucket);
    if (firstEventAt === null || event.timestamp < firstEventAt) firstEventAt = event.timestamp;
    if (lastEventAt === null || event.timestamp > lastEventAt) lastEventAt = event.timestamp;
  }

  const totalDuration = sessions.reduce((sum, s) => sum + s.durationMs, 0);
  const topEvents = [...eventCounts.entries()]
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count);
  const dailyActivity = [...daily.entries()]
    .map(([date, b]) => ({ date, events: b.events, users: b.users.size }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    totalEvents: events.length,
    totalUsers: users.size,
    totalSessions: sessions.length,
    avgSessionDurationMs: sessions.length > 0 ? totalDuration / sessions.length : 0,
    avgEventsPerSession: sessions.length > 0 ? events.length / sessions.length : 0,
    firstEventAt,
    lastEventAt,
    topEvents,
    dailyActivity,
  };
}

/**
 * Classic funnel: for each ordered step, count distinct users who fired the
 * step after having fired all previous steps (timestamp-ordered).
 */
export function computeFunnel(events: UBAEvent[], steps: string[]): FunnelResult {
  if (steps.length === 0) {
    return { steps: [], overallConversion: 0, dropoffStep: null };
  }

  // Per user, collect timestamps for each requested step once.
  const userStepTimes = new Map<string, Map<string, number[]>>();
  for (const event of events) {
    if (!steps.includes(event.event)) continue;
    let byStep = userStepTimes.get(event.userId);
    if (!byStep) {
      byStep = new Map();
      userStepTimes.set(event.userId, byStep);
    }
    const times = byStep.get(event.event) ?? [];
    times.push(event.timestamp);
    byStep.set(event.event, times);
  }

  const reached: number[] = [];
  for (const [, byStep] of userStepTimes) {
    // Walk steps in order, requiring each to happen strictly after the previous.
    let cursor = -Infinity;
    let completed = 0;
    for (const step of steps) {
      const times = (byStep.get(step) ?? []).slice().sort((a, b) => a - b);
      const next = times.find((t) => t > cursor);
      if (next === undefined) break;
      cursor = next;
      completed += 1;
    }
    for (let i = 0; i < completed; i++) reached[i] = (reached[i] ?? 0) + 1;
  }

  let worstDrop = 0;
  let dropoffStep: string | null = null;
  const funnelSteps = steps.map((event, i) => {
    const reachedUsers = reached[i] ?? 0;
    const prev = i === 0 ? null : (reached[i - 1] ?? 0);
    const conversionFromPrevious = prev === null || prev === 0 ? null : reachedUsers / prev;
    if (conversionFromPrevious !== null && 1 - conversionFromPrevious > worstDrop) {
      worstDrop = 1 - conversionFromPrevious;
      dropoffStep = event;
    }
    return { event, reachedUsers, conversionFromPrevious };
  });

  const first = reached[0] ?? 0;
  const last = reached[steps.length - 1] ?? 0;
  return {
    steps: funnelSteps,
    overallConversion: first === 0 ? 0 : last / first,
    dropoffStep,
  };
}

/**
 * Unbounded day-N retention: for each user find their first active day, then
 * check activity exactly N days later for N in [1..maxDays].
 */
export function computeRetention(events: UBAEvent[], maxDays = 7): RetentionPoint[] {
  const userDays = new Map<string, Set<string>>();
  for (const event of events) {
    let days = userDays.get(event.userId);
    if (!days) {
      days = new Set();
      userDays.set(event.userId, days);
    }
    days.add(dayKey(event.timestamp));
  }
  if (userDays.size === 0) return [];

  const points: RetentionPoint[] = [];
  for (let day = 1; day <= maxDays; day++) {
    let cohortSize = 0;
    let retained = 0;
    for (const [, days] of userDays) {
      const first = [...days].sort()[0]!;
      const target = new Date(first + "T00:00:00");
      target.setDate(target.getDate() + day);
      const targetKey = dayKey(target.getTime());
      // Only users old enough to have had the chance to return count.
      cohortSize += 1;
      if (days.has(targetKey)) retained += 1;
    }
    points.push({ day, cohortSize, retained, rate: cohortSize === 0 ? 0 : retained / cohortSize });
  }
  return points;
}
