/**
 * Synthetic demo data generator.
 *
 * Produces a realistic event stream (page views, signups, checkouts,
 * purchases, churned carts) across power/regular/casual user archetypes,
 * plus one injected traffic-spike day so anomaly detection has something
 * to find. Used by `uba demo` to make the package instantly explorable.
 */
import type { TrackInput } from "./types.ts";

/** Deterministic PRNG so demo datasets are reproducible for a given seed. */
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

export interface DemoOptions {
  users?: number;
  days?: number;
  seed?: number;
}

/**
 * Generate demo events ending at "now" and spanning `days` days back.
 * Roughly 15% power users, 35% regular, 50% casual; conversion probability
 * scales with archetype so segmentation produces clearly separated clusters.
 */
export function generateDemoEvents(options: DemoOptions = {}): TrackInput[] {
  const userCount = options.users ?? 60;
  const days = options.days ?? 14;
  const random = makeRandom(options.seed ?? 7);
  const events: TrackInput[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let u = 0; u < userCount; u++) {
    const userId = `user-${String(u + 1).padStart(3, "0")}`;
    const roll = random();
    // Archetype drives visit frequency and funnel completion likelihood.
    const archetype: "power" | "regular" | "casual" = roll < 0.15 ? "power" : roll < 0.5 ? "regular" : "casual";
    const visitProbability = archetype === "power" ? 0.85 : archetype === "regular" ? 0.45 : 0.15;
    const firstDay = Math.floor(random() * Math.max(1, days - 3));

    for (let d = firstDay; d < days; d++) {
      if (random() > visitProbability) continue;
      const dayBase = now - (days - 1 - d) * dayMs;

      // Inject a marketing-campaign spike on day 10: triple the sessions.
      const isSpikeDay = d === 10;
      const sessionCount = isSpikeDay ? 2 + Math.floor(random() * 3) : 1 + (random() < (archetype === "power" ? 0.6 : 0.2) ? 1 : 0);

      for (let s = 0; s < sessionCount; s++) {
        // Session starts at a random hour between 8:00 and 22:00 local.
        const start = dayBase - (dayBase % dayMs) + (8 + Math.floor(random() * 14)) * 60 * 60 * 1000 + s * 3 * 60 * 60 * 1000;
        let cursor = start;
        const push = (event: string, properties?: Record<string, unknown>): void => {
          events.push({ userId, event, timestamp: cursor, ...(properties ? { properties } : {}) });
          cursor += Math.floor(random() * 90 + 10) * 1000;
        };

        push("page_view", { page: "/home" });
        const depth = archetype === "power" ? 4 + Math.floor(random() * 4) : archetype === "regular" ? 2 + Math.floor(random() * 3) : 1 + Math.floor(random() * 2);
        for (let p = 0; p < depth; p++) {
          push("page_view", { page: `/product/${Math.floor(random() * 20) + 1}` });
          if (random() < 0.4) push("button_click", { button: "add_to_cart" });
        }

        // Funnel: signup -> checkout -> purchase, with archetype-scaled rates.
        const signupRate = archetype === "power" ? 0.7 : archetype === "regular" ? 0.4 : 0.12;
        if (d === firstDay && random() < signupRate) {
          push("signup", { plan: random() < 0.3 ? "pro" : "free" });
        }
        if (random() < signupRate * 0.6) {
          push("checkout_start");
          if (random() < 0.65) {
            push("purchase", { value: Math.round(random() * 9000 + 500) / 100 });
          } else {
            push("checkout_abandon");
          }
        }
        if (random() < 0.1) push("logout");
      }
    }
  }

  return events.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
