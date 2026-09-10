/**
 * Behavioral segmentation via k-means over per-user feature vectors.
 *
 * Features are min-max normalized before clustering so that, for example,
 * raw event counts (hundreds) do not dominate session counts (tens).
 * Clusters are then labeled with a transparent heuristic on engagement
 * intensity, giving product teams immediately usable names instead of
 * opaque "cluster 0/1/2".
 */
import type { Segment, Session, UBAEvent } from "./types.ts";
import { dayKey } from "./metrics.ts";

/** Feature vector extracted for a single user. */
export interface UserFeatures {
  userId: string;
  eventCount: number;
  sessionCount: number;
  avgSessionDurationMs: number;
  activeDays: number;
  distinctEventTypes: number;
}

/** Deterministic PRNG (mulberry32) so repeated analyses produce identical segments. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FEATURE_KEYS = ["eventCount", "sessionCount", "avgSessionDurationMs", "activeDays", "distinctEventTypes"] as const;

/** Build one feature vector per user from raw events and sessions. */
export function extractUserFeatures(events: UBAEvent[], sessions: Session[]): UserFeatures[] {
  const byUser = new Map<string, { events: UBAEvent[]; days: Set<string>; types: Set<string> }>();
  for (const event of events) {
    let entry = byUser.get(event.userId);
    if (!entry) {
      entry = { events: [], days: new Set(), types: new Set() };
      byUser.set(event.userId, entry);
    }
    entry.events.push(event);
    entry.days.add(dayKey(event.timestamp));
    entry.types.add(event.event);
  }
  const sessionsByUser = new Map<string, Session[]>();
  for (const session of sessions) {
    const bucket = sessionsByUser.get(session.userId) ?? [];
    bucket.push(session);
    sessionsByUser.set(session.userId, bucket);
  }

  const features: UserFeatures[] = [];
  for (const [userId, entry] of byUser) {
    const userSessions = sessionsByUser.get(userId) ?? [];
    const totalDuration = userSessions.reduce((sum, s) => sum + s.durationMs, 0);
    features.push({
      userId,
      eventCount: entry.events.length,
      sessionCount: userSessions.length,
      avgSessionDurationMs: userSessions.length > 0 ? totalDuration / userSessions.length : 0,
      activeDays: entry.days.size,
      distinctEventTypes: entry.types.size,
    });
  }
  return features;
}

/** Min-max normalize each feature dimension to [0, 1]. */
function normalize(vectors: number[][]): number[][] {
  const dims = vectors[0]?.length ?? 0;
  const mins = new Array<number>(dims).fill(Infinity);
  const maxs = new Array<number>(dims).fill(-Infinity);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) {
      mins[i] = Math.min(mins[i]!, v[i]!);
      maxs[i] = Math.max(maxs[i]!, v[i]!);
    }
  }
  return vectors.map((v) =>
    v.map((value, i) => {
      const range = maxs[i]! - mins[i]!;
      return range === 0 ? 0 : (value - mins[i]!) / range;
    }),
  );
}

function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return sum;
}

/**
 * Run k-means (Lloyd's algorithm) with deterministic seeded init.
 * Returns cluster assignments and final centroids in normalized space.
 */
export function kmeans(vectors: number[][], k: number, seed = 42, maxIterations = 100): { assignments: number[]; centroids: number[][] } {
  const random = makeRandom(seed);
  const dims = vectors[0]?.length ?? 0;
  const effectiveK = Math.max(1, Math.min(k, vectors.length));

  // Random init: pick effectiveK distinct points as starting centroids.
  const indices = vectors.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  let centroids = indices.slice(0, effectiveK).map((i) => [...vectors[i]!]);
  let assignments = new Array<number>(vectors.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (let i = 0; i < vectors.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dist = squaredDistance(vectors[i]!, centroids[c]!);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    if (!changed) break;

    // Recompute centroids as the mean of assigned normalized vectors.
    centroids = centroids.map((_, c) => {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length === 0) return new Array<number>(dims).fill(0);
      return members[0]!.map((_, dim) => members.reduce((sum, m) => sum + m[dim]!, 0) / members.length);
    });
  }
  return { assignments, centroids };
}

/**
 * Heuristic segment labeling from the raw-space centroid: an engagement
 * score combines normalized event volume, session frequency, and active
 * days. High = Power Users, mid = Regular Users, low = Casual / At-Risk.
 */
function labelCluster(rank: number, total: number): string {
  if (total === 1) return "All Users";
  const position = rank / (total - 1); // 0 = highest engagement
  if (position <= 0.34) return "Power Users";
  if (position <= 0.67) return "Regular Users";
  return "Casual / At-Risk Users";
}

/** Full segmentation pipeline: features -> normalize -> k-means -> labeled segments. */
export function segmentUsers(events: UBAEvent[], sessions: Session[], k = 3): Segment[] {
  const features = extractUserFeatures(events, sessions);
  if (features.length === 0) return [];
  const effectiveK = Math.max(1, Math.min(k, features.length));
  const raw = features.map((f) => FEATURE_KEYS.map((key) => f[key]));
  const normalized = normalize(raw);
  const { assignments, centroids } = kmeans(normalized, effectiveK);

  // Rank clusters by engagement proxy: mean of normalized event/session/day dims.
  const engagement = centroids.map((c) => (c[0]! + c[1]! + c[3]!) / 3);
  const ranked = centroids.map((_, i) => i).sort((a, b) => engagement[b]! - engagement[a]!);
  const labels = new Map<number, string>();
  ranked.forEach((clusterId, rank) => labels.set(clusterId, labelCluster(rank, effectiveK)));

  const segments: Segment[] = [];
  for (let c = 0; c < effectiveK; c++) {
    const memberIndices = features.map((_, i) => i).filter((i) => assignments[i] === c);
    const centroid: Record<string, number> = {};
    FEATURE_KEYS.forEach((key, dim) => {
      const values = memberIndices.map((i) => raw[i]![dim]!);
      centroid[key] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    });
    segments.push({
      id: c,
      label: labels.get(c) ?? `Segment ${c}`,
      userCount: memberIndices.length,
      centroid,
      userIds: memberIndices.map((i) => features[i]!.userId),
    });
  }
  return segments.sort((a, b) => b.userCount - a.userCount);
}
