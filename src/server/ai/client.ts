import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { recordAiSpend } from "@/server/ai/budget";
import { env } from "@/server/env";

/**
 * Thin wrapper around the Anthropic SDK for Leash's AI layers.
 *
 * Two tiers:
 *  - "smart": the newest Opus: agent, policy compiler, writers
 *  - "fast":  the newest Haiku: the guard's injection scanner and intent judge (latency matters)
 * Models are resolved at runtime from the Models API (newest of each family) unless pinned with
 * AI_MODEL_SMART / AI_MODEL_FAST, so the app keeps working as new models ship.
 */

export type Tier = "smart" | "fast";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AiUnavailableError extends Error {
  constructor() {
    super("AI is not configured (set ANTHROPIC_API_KEY); using the offline fallback.");
    this.name = "AiUnavailableError";
  }
}

export class AiRefusalError extends Error {
  constructor(
    readonly category: string | null,
    message: string,
  ) {
    super(message);
    this.name = "AiRefusalError";
  }
}

export type AiUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated from list prices; for the dashboard, not for billing. */
  costUsd: number;
  latencyMs: number;
};

const globalForAi = globalThis as unknown as {
  __leashAnthropic?: Anthropic;
  __leashModels?: Partial<Record<Tier, Promise<string>>>;
  __leashFallbacksUnsupported?: boolean;
};

export function getAnthropic(): Anthropic {
  // Only the key matters here: the daily budget decides upstream (features.aiLive) whether a check
  // or a run uses Claude at all, so work that already started can finish.
  if (!env.ANTHROPIC_API_KEY) throw new AiUnavailableError();
  globalForAi.__leashAnthropic ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    // Pin the public API; don't inherit ANTHROPIC_BASE_URL from developer tooling.
    baseURL: process.env.LEASH_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    timeout: 60_000,
    maxRetries: 2,
  });
  return globalForAi.__leashAnthropic;
}

const FAMILY: Record<Tier, string> = { smart: "opus", fast: "haiku" };

/** Newest non-deprecated model whose id contains the family name. */
export function pickNewest(
  models: { id: string; created_at: string; deprecated_at?: string | null }[],
  family: string,
): string | undefined {
  return models
    .filter((m) => m.id.includes(family) && !m.deprecated_at)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]?.id;
}

/** Newest available model of the tier's family (or the pinned override). */
export function resolveModel(tier: Tier): Promise<string> {
  const pinned = tier === "smart" ? env.AI_MODEL_SMART : env.AI_MODEL_FAST;
  if (pinned) return Promise.resolve(pinned);
  const cache = (globalForAi.__leashModels ??= {});
  cache[tier] ??= (async () => {
    const models: { id: string; created_at: string; deprecated_at?: string | null }[] = [];
    for await (const m of getAnthropic().models.list({ limit: 100 })) models.push(m);
    const id = pickNewest(models, FAMILY[tier]);
    if (!id) throw new Error(`No available ${FAMILY[tier]} model for tier ${tier}`);
    return id;
  })().catch((err) => {
    delete cache[tier];
    throw err;
  });
  return cache[tier]!;
}

/** Approximate list prices per million tokens for the current generation of each family. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function estimateCost(
  model: string,
  u: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  const family = Object.keys(PRICES).find((f) => model.includes(f)) ?? "opus";
  const p = PRICES[family];
  const usd =
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * One schema-constrained call. The system prompt is cached (it's long and stable); the volatile
 * request goes in the user turn. Refusals throw AiRefusalError so callers fall back safely.
 */
export async function runStructured<S extends z.ZodType>({
  tier,
  system,
  user,
  schema,
  effort = tier === "fast" ? "low" : "medium",
  maxTokens = 8000,
}: {
  tier: Tier;
  system: string;
  user: string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; usage: AiUsage }> {
  const client = getAnthropic();
  const model = await resolveModel(tier);
  const started = Date.now();
  // Server-side refusal fallback for the smart tier (routes a declined request to another model).
  const useFallbacks = tier === "smart" && !globalForAi.__leashFallbacksUnsupported;

  const request = (withFallbacks: boolean) =>
    client.beta.messages.parse({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { format: betaZodOutputFormat(schema), effort },
      ...(withFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

  let response;
  try {
    response = await request(useFallbacks);
  } catch (err) {
    if (useFallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      globalForAi.__leashFallbacksUnsupported = true;
      response = await request(false);
    } else {
      throw err;
    }
  }

  if (response.stop_reason === "refusal") {
    throw new AiRefusalError(
      response.stop_details?.category ?? null,
      response.stop_details?.explanation ?? "The model declined this request.",
    );
  }
  if (response.parsed_output == null) {
    throw new Error(`Structured output missing (stop_reason: ${response.stop_reason})`);
  }

  const u = response.usage;
  const usage: AiUsage = {
    model: response.model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    costUsd: estimateCost(response.model, {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    }),
    latencyMs: Date.now() - started,
  };
  recordAiSpend(usage.costUsd);
  return { data: response.parsed_output as z.infer<S>, usage };
}

/**
 * Wraps untrusted third-party text (listings, emails, invoices) so models treat it as data.
 * Closing tags inside the text are neutralized so content can't "escape" its block.
 */
export function untrustedBlock(sourceId: string, kind: string, text: string): string {
  const safe = text.replace(/<\/?untrusted_content[^>]*>/gi, "[tag removed]");
  return `<untrusted_content source_id="${sourceId}" kind="${kind}">\n${safe}\n</untrusted_content>`;
}

/** Keywords outside the structured-outputs subset; dropped from runtime schemas (e.g. AG Grid's). */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "pattern",
  "minLength",
  "maxLength",
]);

export function sanitizeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
    out[k] = sanitizeJsonSchema(v);
  }
  if (out.type === "object" && out.properties && out.additionalProperties === undefined) {
    out.additionalProperties = false;
  }
  return out;
}

/** Structured output against a JSON schema known only at runtime (e.g. AG Grid's state schema). */
export async function runJsonSchema<T = unknown>({
  tier,
  system,
  user,
  schema,
  effort = "low",
  maxTokens = 4000,
}: {
  tier: Tier;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}): Promise<{ data: T; usage: AiUsage }> {
  const client = getAnthropic();
  const model = await resolveModel(tier);
  const started = Date.now();
  const response = await client.beta.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema }, effort },
  });
  if (response.stop_reason === "refusal") {
    throw new AiRefusalError(
      response.stop_details?.category ?? null,
      response.stop_details?.explanation ?? "The model declined this request.",
    );
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text")
    throw new Error(`No JSON in response (stop_reason: ${response.stop_reason})`);
  const u = response.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const costUsd = estimateCost(response.model, {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead,
    cacheWrite,
  });
  recordAiSpend(costUsd);
  return {
    data: JSON.parse(text.text) as T,
    usage: {
      model: response.model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      costUsd,
      latencyMs: Date.now() - started,
    },
  };
}
