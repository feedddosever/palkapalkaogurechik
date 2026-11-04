import { features } from "@/server/env";
import { runJsonSchema, sanitizeJsonSchema, type AiUsage } from "./client";

/**
 * "Ask the ledger": plain English → AG Grid state. The grid describes its own state as a JSON
 * schema (AG Grid AI Toolkit, api.getStructuredSchema()); Claude answers in exactly that shape and
 * the browser applies it with api.setState(). Offline, a keyword parser builds the same state shape.
 */

export type LedgerAnswer = {
  state: Record<string, unknown>;
  explanation: string;
  source: "ai" | "offline";
  usage?: AiUsage;
};

export type LedgerContext = {
  suppliers: string[];
  statuses: string[];
  categories: string[];
  weeks: string[];
};

const MAX_SCHEMA_BYTES = 80_000;

const SYSTEM = `You turn a small-business owner's question about their payment ledger into AG Grid state.
The ledger lists every payment their AI agent asked for (columns: date, week, event, supplier, category, description, amount, spent, status, decidedBy, reason, vsMarketPct, saved) plus PayPal holds.
"spent" only counts money that actually moved; "amount" is what was requested. Status values: Paid, Waiting for you, Blocked, Denied, Failed, Approved, Held, Released.
Return the grid state that best answers the question: filters, sorting, row grouping, aggregation or pivot. Leave anything the question doesn't ask for empty. "explanation" is one short sentence describing the view, written for the owner.`;

export async function askLedger(
  question: string,
  gridSchema: unknown,
  ctx: LedgerContext,
  { ai = features.aiLive }: { ai?: boolean } = {},
): Promise<LedgerAnswer> {
  const q = question.trim().slice(0, 500);
  if (!ai || !gridSchema || JSON.stringify(gridSchema).length > MAX_SCHEMA_BYTES) return askOffline(q, ctx);

  const sanitized = sanitizeJsonSchema(gridSchema) as Record<string, unknown>;
  const { $defs, ...stateSchema } = sanitized;
  const schema: Record<string, unknown> = {
    type: "object",
    properties: { state: stateSchema, explanation: { type: "string" } },
    required: ["state", "explanation"],
    additionalProperties: false,
  };
  if ($defs) schema.$defs = $defs;

  try {
    const { data, usage } = await runJsonSchema<{ state: Record<string, unknown>; explanation: string }>({
      tier: "fast",
      system: SYSTEM,
      user: [
        `Suppliers: ${ctx.suppliers.join(", ")}`,
        `Categories: ${ctx.categories.join(", ")}`,
        `Weeks (Monday dates, newest last): ${ctx.weeks.join(", ")}`,
        "",
        `Question: ${q}`,
      ].join("\n"),
      schema,
      effort: "low",
    });
    return { state: data.state, explanation: data.explanation, source: "ai", usage };
  } catch {
    return askOffline(q, ctx);
  }
}

const STATUS_WORDS: [RegExp, string[]][] = [
  [/\bblock(ed|s)?\b|attack|scam|stopped/, ["Blocked"]],
  [/waiting|pending|approval|ask(ed)? me/, ["Waiting for you"]],
  [/\bdenied|declined|rejected\b/, ["Denied"]],
  [/\bpaid\b|spent|spend|bought|purchases?\b/, ["Paid"]],
  [/\bholds?\b|released?/, ["Held", "Released"]],
];

const GROUP_WORDS: [RegExp, string][] = [
  [/by supplier|per supplier|each supplier/, "supplier"],
  [/by week|per week|weekly|each week/, "week"],
  [/by status|per status/, "status"],
  [/by category|per category/, "category"],
  [/by (?:layer|decided)/, "decidedBy"],
];

/** Deterministic plain English → GridState for offline mode. */
export function askOffline(question: string, ctx: LedgerContext): LedgerAnswer {
  const q = question.toLowerCase();
  const filterModel: Record<string, unknown> = {};
  const parts: string[] = [];

  const statuses = [...new Set(STATUS_WORDS.filter(([re]) => re.test(q)).flatMap(([, v]) => v))];
  if (statuses.length) {
    filterModel.status = { filterType: "set", values: statuses };
    parts.push(statuses.join(" or ").toLowerCase());
  }

  const suppliers = ctx.suppliers.filter((s) => {
    const name = s.toLowerCase();
    return q.includes(name) || q.includes(name.split(" ")[0]);
  });
  if (suppliers.length) {
    filterModel.supplier = { filterType: "set", values: suppliers };
    parts.push(`from ${suppliers.join(", ")}`);
  }

  const over = /(?:over|above|more than|greater than|>)\s*\$?\s*(\d+(?:\.\d+)?)/.exec(q);
  const under = /(?:under|below|less than|<)\s*\$?\s*(\d+(?:\.\d+)?)/.exec(q);
  if (over) {
    filterModel.amount = { filterType: "number", type: "greaterThan", filter: Number(over[1]) };
    parts.push(`over $${over[1]}`);
  } else if (under) {
    filterModel.amount = { filterType: "number", type: "lessThan", filter: Number(under[1]) };
    parts.push(`under $${under[1]}`);
  }

  if (/this week|current week/.test(q) && ctx.weeks.length) {
    filterModel.week = { filterType: "set", values: [ctx.weeks[ctx.weeks.length - 1]] };
    parts.push("this week");
  }

  const group = GROUP_WORDS.find(([re]) => re.test(q))?.[1];
  const sortDesc = /largest|biggest|highest|most expensive|\btop\b/.test(q);
  const recent = /latest|recent|newest/.test(q);

  const state: Record<string, unknown> = {};
  if (Object.keys(filterModel).length) state.filter = { filterModel };
  if (group) {
    state.rowGroup = { groupColIds: [group] };
    state.aggregation = {
      aggregationModel: [
        { colId: "spent", aggFunc: "sum" },
        { colId: "amount", aggFunc: "sum" },
      ],
    };
    parts.push(`grouped by ${group === "decidedBy" ? "deciding layer" : group}`);
  }
  if (sortDesc) state.sort = { sortModel: [{ colId: "amount", sort: "desc" }] };
  else if (recent) state.sort = { sortModel: [{ colId: "date", sort: "desc" }] };

  const explanation = parts.length
    ? `Showing ${parts.join(", ")}.`
    : "Showing everything. Try “blocked payments by supplier” or “paid over $100”.";
  return { state, explanation, source: "offline" };
}
