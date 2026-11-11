import { z } from "zod";
import { aiSpentToday } from "@/server/ai/budget";

/**
 * Environment configuration.
 *
 * Every integration key is optional. Leash runs end-to-end with zero keys
 * (simulator + fixtures + heuristic fallbacks). `features` reports which
 * integrations run live, so each module can pick live or fallback mode.
 */

// Treat empty strings (common in .env files) as "not set".
const optional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Public base URL. On Render, RENDER_EXTERNAL_URL is used when APP_URL isn't set.
  APP_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.url().default("http://localhost:3000"),
  ),

  // Database: Postgres when DATABASE_URL is set, otherwise embedded PGlite.
  DATABASE_URL: optional,
  PGLITE_DIR: optional,

  // PayPal (sandbox only).
  PAYPAL_CLIENT_ID: optional,
  PAYPAL_CLIENT_SECRET: optional,
  PAYPAL_WEBHOOK_ID: optional,
  /** auto = sandbox when credentials exist, else simulator. */
  PAYPAL_MODE: z.enum(["auto", "sim", "sandbox"]).default("auto"),
  /**
   * JSON map from demo supplier payee emails to real sandbox business-account emails, e.g.
   * {"billing@northside-roasters.example":"sb-abc@business.example.com"}. Sandbox mode only.
   */
  PAYPAL_PAYEE_MAP: optional,

  // AI (Claude via Anthropic API).
  ANTHROPIC_API_KEY: optional,
  AI_MODEL_SMART: optional,
  AI_MODEL_FAST: optional,
  /** Daily cap on estimated Claude spend for the whole deployment; above it Leash runs offline until 00:00 UTC. */
  AI_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(5),

  // Product data.
  CHANNEL3_API_KEY: optional,

  // AG Grid Enterprise license (exposed to the browser by design).
  NEXT_PUBLIC_AG_GRID_LICENSE_KEY: optional,

  // Ed25519 private key (PKCS#8, base64) for intent receipts. Generated in dev if absent.
  RECEIPT_SIGNING_KEY: optional,

  /** Bearer token for POST /api/cron/cycles (unset = the endpoint is disabled). */
  CRON_SECRET: optional,

  // Judge mode: the PayPal sandbox test buyer judges log in with to approve the hold
  // (sandbox-only credentials, shown on the onboarding page on purpose).
  JUDGE_BUYER_EMAIL: optional,
  JUDGE_BUYER_PASSWORD: optional,
  /** Language of PayPal's checkout pages (BCP 47), whatever the buyer account's country. */
  PAYPAL_CHECKOUT_LOCALE: z.string().default("en-US"),

  // Attack Lab (public): on = normal; offline = never call Claude from the lab; off = kill switch.
  LAB_MODE: z.enum(["on", "offline", "off"]).default("on"),
  /** Daily cap on estimated Claude spend from lab runs; above it the lab runs offline. */
  LAB_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  /** Lab runs allowed per visitor in 10 minutes. */
  LAB_RUNS_PER_CLIENT: z.coerce.number().int().positive().default(6),
  /** Demo cafés idle this long have their PayPal hold voided by the cycle jobs (0 = only at week's end). */
  DEMO_HOLD_IDLE_HOURS: z.coerce.number().nonnegative().default(2),
  /** Run the cycle jobs inside the web server (hourly), for hosts without a cron job. */
  CYCLE_JOBS_IN_PROCESS: z.enum(["on", "off"]).default("on"),
  /** Fresh demo cafés (/demo) allowed per visitor per hour. */
  DEMO_PER_CLIENT_HOURLY: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const withDefaults =
    source.APP_URL?.trim() || !source.RENDER_EXTERNAL_URL
      ? source
      : { ...source, APP_URL: source.RENDER_EXTERNAL_URL };
  const result = schema.safeParse(withDefaults);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export type Features = {
  /** Real PayPal sandbox calls (vs. the local simulator). */
  paypalLive: boolean;
  /** Real Claude calls (vs. heuristic / fixture fallbacks). */
  aiLive: boolean;
  /** Real Channel3 product search (vs. recorded fixtures). */
  channel3Live: boolean;
  /** AG Grid Enterprise license present (vs. trial watermark). */
  agGridLicensed: boolean;
  /** Postgres (vs. embedded PGlite). */
  postgres: boolean;
};

export function deriveFeatures(e: Env): Features {
  const hasPaypalKeys = Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_SECRET);
  if (e.PAYPAL_MODE === "sandbox" && !hasPaypalKeys) {
    throw new Error("PAYPAL_MODE=sandbox requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
  }
  return {
    paypalLive: e.PAYPAL_MODE === "sandbox" || (e.PAYPAL_MODE === "auto" && hasPaypalKeys),
    aiLive: Boolean(e.ANTHROPIC_API_KEY),
    channel3Live: Boolean(e.CHANNEL3_API_KEY),
    agGridLicensed: Boolean(e.NEXT_PUBLIC_AG_GRID_LICENSE_KEY),
    postgres: Boolean(e.DATABASE_URL),
  };
}

let cached: { env: Env; features: Features } | undefined;

function load() {
  if (!cached) {
    const env = parseEnv(process.env);
    cached = { env, features: deriveFeatures(env) };
  }
  return cached;
}

/** Test hook: re-read process.env on next access. */
export function resetEnvForTesting(): void {
  cached = undefined;
}

export const env = new Proxy({} as Env, {
  get: (_t, key: string) => load().env[key as keyof Env],
});

/** A key is configured and today's Claude spend is under AI_DAILY_BUDGET_USD. */
function aiAvailable(): boolean {
  const { env, features } = load();
  return features.aiLive && aiSpentToday() < env.AI_DAILY_BUDGET_USD;
}

/** True when Claude is configured but today's budget is used up (Leash is running offline). */
export function aiBudgetReached(): boolean {
  return load().features.aiLive && !aiAvailable();
}

export const features = new Proxy({} as Features, {
  get: (_t, key: string) => (key === "aiLive" ? aiAvailable() : load().features[key as keyof Features]),
});

/** Snapshot safe to expose publicly (no secrets). */
export function publicFeatureSnapshot(): Features {
  return { ...load().features, aiLive: aiAvailable() };
}
