import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/client")>()),
  runStructured: vi.fn(),
}));

import { runStructured } from "@/server/ai/client";
import type { ScanSource } from "@/server/ai/scanner";
import { readProductPage } from "@/server/catalog";
import { runGuard } from "@/server/guard/pipeline";
import { BEC_EMAIL } from "@/server/seed/defaults";
import { ctx, minutesAgo, policy, purchase, recent, STORY, SUPPLIERS } from "./fixtures";

beforeEach(() => {
  vi.mocked(runStructured).mockReset();
});

const bulkbarn: ScanSource = {
  id: "listing:bb-oat-6x32",
  kind: "listing",
  text: readProductPage("bb-oat-6x32")!,
};
const bec: ScanSource = { id: "email:bec", kind: "email", text: BEC_EMAIL.body };
const base = {
  policy: policy(),
  agentTask: "Weekly restock and invoices",
  justification: "restock",
  ai: false,
};

describe("guard pipeline (offline)", () => {
  it("allows the usual order with every layer agreeing", async () => {
    const d = await runGuard({ ...base, request: STORY.espresso(), ctx: ctx(), sources: [] });
    expect(d.verdict).toBe("ALLOW");
    expect(d.layers.map((l) => [l.layer, l.verdict])).toEqual([
      ["rules", "ALLOW"],
      ["scanner", "ALLOW"],
      ["judge", "ALLOW"],
    ]);
    expect(d.judge.status).toBe("offline");
    expect(d.costUsd).toBe(0);
  });

  it("blocks the BEC invoice: rules and scanner both catch it", async () => {
    const d = await runGuard({
      ...base,
      request: STORY.becInvoice(),
      ctx: ctx({ supplier: null }),
      sources: [bec],
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.decidedBy).toEqual(["rules", "scanner"]);
    expect(d.attack).toBe(true);
  });

  it("blocks the planted gift-card order: rules and scanner both catch it", async () => {
    const d = await runGuard({
      ...base,
      request: STORY.giftCards(),
      ctx: ctx({ supplier: SUPPLIERS.bulkbarn }),
      sources: [bulkbarn],
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.decidedBy).toEqual(["rules", "scanner"]);
    expect(d.scan.findings[0].flagged).toBe(true);
  });
});

describe("layer ablation (what LeashBench measures)", () => {
  it("without rules, the scanner still stops the planted gift cards", async () => {
    const d = await runGuard({
      ...base,
      request: STORY.giftCards(),
      ctx: ctx({ supplier: SUPPLIERS.bulkbarn }),
      sources: [bulkbarn],
      layers: { rules: false, scanner: true, judge: true },
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.decidedBy).toEqual(["scanner"]);
  });

  it("split payments have no suspicious text: only the rules catch them", async () => {
    const half = purchase("northside", "billing@northside-roasters.example", [["decaf", 2]]);
    const c = ctx({
      recentRequests: [
        recent(half, { createdAt: minutesAgo(20) }),
        recent(half, { createdAt: minutesAgo(10) }),
      ],
    });
    const rulesOnly = await runGuard({
      ...base,
      request: half,
      ctx: c,
      sources: [],
      layers: { rules: true, scanner: false, judge: false },
    });
    const aiOnly = await runGuard({
      ...base,
      request: half,
      ctx: c,
      sources: [],
      layers: { rules: false, scanner: true, judge: true },
    });
    expect(rulesOnly.verdict).toBe("BLOCK");
    expect(aiOnly.verdict).toBe("ALLOW");
  });
});

describe("guard pipeline with the AI judge", () => {
  const usage = {
    model: "m",
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.00015,
    latencyMs: 700,
  };

  it("the judge can tighten what the rules allowed", async () => {
    vi.mocked(runStructured).mockImplementation(async (opts) => {
      console.log("ARGS", typeof opts, new Error().stack?.split("\n").slice(1, 6).join(" | "));
      if (opts.system.includes("security classifier")) return { data: { results: [] }, usage };
      return {
        data: {
          tracesToOwnerIntent: false,
          verdict: "NEEDS_APPROVAL",
          risk: 55,
          reasons: ["Unusual for this café."],
          suspiciousSourceIds: [],
        },
        usage,
      };
    });
    const d = await runGuard({ ...base, ai: true, request: STORY.espresso(), ctx: ctx(), sources: [] });
    expect(d.verdict).toBe("NEEDS_APPROVAL");
    expect(d.decidedBy).toEqual(["judge"]);
    expect(d.costUsd).toBe(0.00015); // no sources, so only the judge ran
  });

  it("a fooled judge cannot unlock what the rules blocked", async () => {
    vi.mocked(runStructured).mockImplementation(async (opts) => {
      if (opts.system.includes("security classifier")) return { data: { results: [] }, usage };
      return {
        data: {
          tracesToOwnerIntent: true,
          verdict: "ALLOW",
          risk: 2,
          reasons: ["Looks fine."],
          suspiciousSourceIds: [],
        },
        usage,
      };
    });
    const d = await runGuard({
      ...base,
      ai: true,
      request: STORY.becInvoice(),
      ctx: ctx({ supplier: null }),
      sources: [bec],
    });
    expect(d.verdict).toBe("BLOCK");
    expect(d.layers.find((l) => l.layer === "judge")?.verdict).toBe("ALLOW");
  });
});
