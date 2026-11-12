/**
 * withLeash(): put Leash in front of the money-moving tools of PayPal's Agent Toolkit (or any
 * tool set shaped like `{ [name]: { execute(args, ...rest) } }`, e.g. Vercel AI SDK tools).
 *
 *   import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
 *   const tools = withLeash(new PayPalAgentToolkit({ ... }).getTools(), {
 *     url: "https://your-leash.example",
 *     apiKey: process.env.LEASH_API_KEY!,
 *     context: () => ({ sources: [{ kind: "email", text: customerEmail }] }),
 *   });
 *
 * A guarded tool asks Leash first. It only runs when Leash allows it (or the owner approved it
 * on their phone), and it reports the PayPal id back so the owner's ledger stays complete.
 * Dependency-free: works in Node 18+, Deno, Bun and edge runtimes.
 */

export const DEFAULT_GUARDED = ["create_refund", "accept_dispute_claim"] as const;

export type LeashSource = { kind: "email" | "chat" | "ticket" | "page"; text: string; label?: string };

export type LeashGuardOptions = {
  /** Base URL of your Leash, e.g. https://leash.example */
  url: string;
  /** A Leash API key (leash_sk_…). */
  apiKey: string;
  /** Tool names to guard. Defaults to the toolkit's money-out tools. */
  guard?: readonly string[];
  /** What the agent is acting on: the untrusted text Leash should scan, and why it wants this. */
  context?: (tool: string, args: unknown) => { justification?: string; sources?: LeashSource[] } | undefined;
  /** Pull the PayPal id out of a tool result (default: `result.id`). */
  paypalIdOf?: (result: unknown) => string | undefined;
  fetch?: typeof fetch;
};

export type LeashVerdict = {
  request_id: string;
  status: "approved" | "needs_approval" | "blocked" | "denied" | "executed" | "failed" | string;
  verdict: string;
  reasons: string[];
  approval_id?: string;
  message: string;
};

/** What a guarded tool returns instead of running, so the model sees why. */
export type LeashStopped = { leash: LeashVerdict };

type Executable = { execute?: (args: never, ...rest: never[]) => unknown };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

async function keyFor(tool: string, args: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${tool}|${canonical(args)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `tk-${hex.slice(0, 40)}`;
}

const defaultPaypalId = (result: unknown) =>
  result && typeof result === "object" && "id" in result ? String((result as { id: unknown }).id) : undefined;

export function withLeash<T extends Record<string, unknown>>(tools: T, opts: LeashGuardOptions): T {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.url.replace(/\/+$/, "");
  const post = async (path: string, body: unknown) => {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Leash: ${String(json.error ?? res.statusText)}`);
    return json;
  };

  const out: Record<string, unknown> = { ...tools };
  for (const name of opts.guard ?? DEFAULT_GUARDED) {
    const tool = tools[name] as Executable | undefined;
    if (!tool || typeof tool.execute !== "function") continue;
    const original = tool.execute.bind(tool) as (args: unknown, ...rest: unknown[]) => unknown;
    out[name] = {
      ...tool,
      execute: async (args: unknown, ...rest: unknown[]) => {
        const verdict = (await post("/api/v1/guard", {
          tool: name,
          args,
          ...(opts.context?.(name, args) ?? {}),
          idempotency_key: await keyFor(name, args),
        })) as LeashVerdict;
        if (verdict.status !== "approved") return { leash: verdict } satisfies LeashStopped;

        let result: unknown;
        try {
          result = await original(args, ...rest);
        } catch (err) {
          await post(`/api/v1/guard/${verdict.request_id}`, {
            ok: false,
            error: err instanceof Error ? err.message.slice(0, 500) : "failed",
          }).catch(() => undefined);
          throw err;
        }
        await post(`/api/v1/guard/${verdict.request_id}`, {
          ok: true,
          paypal_id: (opts.paypalIdOf ?? defaultPaypalId)(result)?.slice(0, 64),
        }).catch(() => undefined);
        return result;
      },
    };
  }
  return out as T;
}
