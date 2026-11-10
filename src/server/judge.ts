import { env, features } from "@/server/env";
import { getPayPal } from "@/server/paypal";

/**
 * Judge mode helpers: simple per-process rate limits for the public, expensive entry points, the
 * PayPal sandbox buyer login judges use to approve the hold, and a cached sandbox health check.
 */

const HOUR = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

/** Sliding-window limit: true when this call is allowed. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, ts] of hits) if (ts.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return true;
}

/** Each /demo visit creates a seeded workspace: 15 per visitor (DEMO_PER_CLIENT_HOURLY) and 400 overall per hour. */
export const allowDemo = (clientKey: string) =>
  rateLimit(`demo:${clientKey}`, env.DEMO_PER_CLIENT_HOURLY, HOUR) && rateLimit("demo:all", 400, HOUR);

/** AI-backed owner actions (compile rules, ask the ledger): 30 per workspace per hour. */
export const allowAiAction = (workspaceId: string) => rateLimit(`ai:${workspaceId}`, 30, HOUR);

export type JudgeInfo = {
  paypalLive: boolean;
  /** PayPal sandbox test buyer (shown to judges on purpose: sandbox-only, no real money). */
  buyer: { email: string; password: string } | null;
};

export function judgeInfo(): JudgeInfo {
  return {
    paypalLive: features.paypalLive,
    buyer:
      env.JUDGE_BUYER_EMAIL && env.JUDGE_BUYER_PASSWORD
        ? { email: env.JUDGE_BUYER_EMAIL, password: env.JUDGE_BUYER_PASSWORD }
        : null,
  };
}

let health: { at: number; ok: boolean } | undefined;

/** Whether the PayPal sandbox answers (OAuth), cached for a minute. Always true in simulator mode. */
export async function paypalReachable(now = Date.now()): Promise<boolean> {
  if (!features.paypalLive) return true;
  if (health && now - health.at < 60_000) return health.ok;
  const gateway = getPayPal() as { ping?: () => Promise<boolean> };
  let ok = true;
  try {
    ok = gateway.ping
      ? await Promise.race([
          gateway.ping(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
        ])
      : true;
  } catch {
    ok = false;
  }
  health = { at: now, ok };
  return ok;
}
