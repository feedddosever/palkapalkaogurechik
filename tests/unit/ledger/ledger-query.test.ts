import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/client")>()),
  runJsonSchema: vi.fn(),
}));

import { runJsonSchema, sanitizeJsonSchema } from "@/server/ai/client";
import { askLedger, askOffline, type LedgerContext } from "@/server/ai/ledger-query";

beforeEach(() => {
  vi.mocked(runJsonSchema).mockReset();
});

const ctx: LedgerContext = {
  suppliers: ["Northside Roasters", "Oat & Co", "PaperGoods Supply", "PayPal"],
  statuses: ["Blocked", "Paid", "Waiting for you"],
  categories: ["Coffee", "Invoice"],
  weeks: ["2026-10-26", "2026-11-02"],
};

describe("offline ledger questions", () => {
  it("blocked payments by supplier", () => {
    const a = askOffline("What did Leash block, by supplier?", ctx);
    expect(a.state).toEqual({
      filter: { filterModel: { status: { filterType: "set", values: ["Blocked"] } } },
      rowGroup: { groupColIds: ["supplier"] },
      aggregation: {
        aggregationModel: [
          { colId: "spent", aggFunc: "sum" },
          { colId: "amount", aggFunc: "sum" },
        ],
      },
    });
    expect(a.explanation).toBe("Showing blocked, grouped by supplier.");
  });

  it("amounts, suppliers, this week and sorting", () => {
    const a = askOffline("largest Northside payments over $50 this week", ctx);
    expect(a.state.filter).toEqual({
      filterModel: {
        supplier: { filterType: "set", values: ["Northside Roasters"] },
        amount: { filterType: "number", type: "greaterThan", filter: 50 },
        week: { filterType: "set", values: ["2026-11-02"] },
      },
    });
    expect(a.state.sort).toEqual({ sortModel: [{ colId: "amount", sort: "desc" }] });
  });

  it("explains how to ask when nothing matched", () => {
    expect(askOffline("hello", ctx)).toMatchObject({ state: {}, source: "offline" });
  });
});

describe("AI ledger questions (AG Grid AI Toolkit schema)", () => {
  const gridSchema = {
    type: "object",
    properties: {
      filter: { $ref: "#/$defs/filter" },
      sort: { type: "object", properties: { n: { type: "integer", minimum: 0 } }, required: [] },
    },
    required: [],
    $defs: { filter: { type: "object", properties: {}, required: [] } },
  };

  it("wraps the grid's schema, hoists $defs and strips unsupported keywords", async () => {
    vi.mocked(runJsonSchema).mockResolvedValueOnce({
      data: {
        state: { sort: { sortModel: [{ colId: "amount", sort: "desc" }] } },
        explanation: "Biggest first.",
      },
      usage: {
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        latencyMs: 1,
      },
    });
    const a = await askLedger("biggest payments", gridSchema, ctx, { ai: true });
    expect(a).toMatchObject({ source: "ai", explanation: "Biggest first." });
    const sent = vi.mocked(runJsonSchema).mock.calls[0][0].schema as Record<string, unknown>;
    expect(sent.$defs).toEqual({
      filter: { type: "object", properties: {}, required: [], additionalProperties: false },
    });
    expect(JSON.stringify(sent)).not.toContain("minimum");
    expect((sent.properties as Record<string, unknown>).state).not.toHaveProperty("$defs");
    expect(vi.mocked(runJsonSchema).mock.calls[0][0].tier).toBe("fast");
  });

  it("falls back to the offline parser on errors or oversized schemas", async () => {
    vi.mocked(runJsonSchema).mockRejectedValueOnce(new Error("boom"));
    expect((await askLedger("blocked", gridSchema, ctx, { ai: true })).source).toBe("offline");
    const huge = { type: "object", properties: { x: { description: "y".repeat(90_000) } } };
    expect((await askLedger("blocked", huge, ctx, { ai: true })).source).toBe("offline");
    expect(runJsonSchema).toHaveBeenCalledTimes(1);
  });

  it("sanitizer keeps structure, drops numeric limits, closes objects", () => {
    expect(
      sanitizeJsonSchema({
        type: "object",
        properties: { a: { type: "array", items: { type: "number", maximum: 3 }, maxItems: 2 } },
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "array", items: { type: "number" } } },
      additionalProperties: false,
    });
  });
});
