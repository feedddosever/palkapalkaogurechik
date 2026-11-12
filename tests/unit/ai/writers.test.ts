import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/client")>()),
  runStructured: vi.fn().mockRejectedValue(new Error("down")),
}));

import { promotionOffline, writePromotionCase, type TrackRecord } from "@/server/ai/writers";

const record: TrackRecord = {
  agentName: "Ops agent",
  level: 1,
  nextLevel: 2,
  windowDays: 28,
  executed: 23,
  approvalsGranted: 2,
  denials: 0,
  blocks: 0,
  avgVsMarketPct: -6.2,
  savingsUsd: "$41.30",
};

describe("promotion writer", () => {
  it("offline template uses only the given numbers", () => {
    const c = promotionOffline(record);
    expect(c.headline).toBe("Give Ops agent a longer leash: move to L2 Budgeted?");
    expect(c.reasons[0]).toContain("23 payments in the last 28 days");
    expect(c.reasons[1]).toContain("6.2% below market");
    expect(c.reasons[3]).toContain("never go through");
  });

  it("falls back to the template when the AI call fails", async () => {
    expect((await writePromotionCase(record, { ai: true })).source).toBe("offline");
  });
});
