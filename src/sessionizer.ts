/**
 * Sessionizer: groups raw events into per-user sessions using the classic
 * inactivity-gap model (a new session starts after `timeoutMs` of silence).
 * Sessions feed session duration, engagement depth, and the feature vectors
 * used by behavioral segmentation.
 */
import type { Session, UBAEvent } from "./types.ts";

/**
 * Split events into sessions per user.
 * Events are sorted by timestamp; each returned session carries the
 * resolved sessionId which is also written back onto the event objects.
 */
export function sessionize(events: UBAEvent[], timeoutMs: number): Session[] {
  const byUser = new Map<string, UBAEvent[]>();
  for (const event of events) {
    const bucket = byUser.get(event.userId);
    if (bucket) bucket.push(event);
    else byUser.set(event.userId, [event]);
  }

  const sessions: Session[] = [];
  for (const [userId, userEvents] of byUser) {
    userEvents.sort((a, b) => a.timestamp - b.timestamp);
    let current: UBAEvent[] = [];
    let sessionIndex = 0;

    const flush = (): void => {
      if (current.length === 0) return;
      const start = current[0]!.timestamp;
      const end = current[current.length - 1]!.timestamp;
      const sessionId = `${userId}-s${++sessionIndex}-${start}`;
      for (const event of current) event.sessionId = sessionId;
      sessions.push({
        sessionId,
        userId,
        start,
        end,
        durationMs: end - start,
        eventCount: current.length,
        events: current,
      });
      current = [];
    };

    for (const event of userEvents) {
      // A gap larger than the timeout closes the previous session.
      if (current.length > 0 && event.timestamp - current[current.length - 1]!.timestamp > timeoutMs) {
        flush();
      }
      current.push(event);
    }
    flush();
  }

  return sessions.sort((a, b) => a.start - b.start);
}
