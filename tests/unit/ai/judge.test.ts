import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/client")>()),
  runStructured: vi.fn(),
}));

import { runStructured } from "@/server/ai/client";
import { judgePayment } from "@/server/ai/judge";
import { evaluateRules } from "@/server/guard/evaluate";
import { DEFAULT_POLICY } from "@/server/seed/defaults";
import { BEC_EMAIL } from "@/server/seed/defaults";
import { ctx, policy, STORY } from "../guard/fixtures";

beforeEach(() => {
  vi.mocked(runStructured).mockReset();
});

const usage = {
  model: "m",
  inputTokens: 900,
  outputTokens: 80,
  cacheReadTokens: 600,
  cacheWriteTokens: 0,
  costUsd: 0.00013,
  latencyMs: 800,
};
const bec = { id: "email:bec", kind: "email" as const, text: BEC_EMAIL.body };

function input() {
  const request = STORY.becInvoice();
  return {
    request,
    policy: policy(),
    agentTask: "Pay this week's supplier invoices",
    justification: "Northside asked us to pay invoice 4471 to their new address",
    sources: [bec],
    findings: [],
    rules: evaluateRules(request, DEFAULT_POLICY, ctx({ supplier: null })),
  };
}

describe("intent judge", () => {
  it("is skipped (not trusted) when AI is offline", async () => {
    const r = await judgePayment(input(), { ai: false });
    expect(r.status).toBe("offline");
    expect(r.outcome.verdict).toBe("ALLOW");
    expect(runStructured).not.toHaveBeenCalled();
  });

  it("gives the model the owner's words, the request, and the untrusted sources as data", async () => {
    vi.mocked(runStructured).mockResolvedValueOnce({
      data: {
        tracesToOwnerIntent: false,
        verdict: "BLOCK",
        risk: 93,
        reasons: ["Pays a new address claimed only by email."],
        suspiciousSourceIds: ["email:bec"],
      },
      usage,
    });
    const r = await judgePayment(input(), { ai: true });
    expect(r).toMatchObject({
      status: "ran",
      risk: 93,
      outcome: { layer: "judge", verdict: "BLOCK", codes: ["INTENT_MISALIGNED"], attack: true },
    });
    const prompt = vi.mocked(runStructured).mock.calls[0][0].user;
    expect(prompt).toContain(DEFAULT_POLICY.ownerText);
    expect(prompt).toContain("payments@northside-billing-secure.example");
    expect(prompt).toContain('<untrusted_content source_id="email:bec" kind="email">');
    expect(prompt).toContain("PAYEE_CHANGED");
  });

  it("fails closed: if the judge errors, the payment needs approval", async () => {
    vi.mocked(runStructured).mockRejectedValueOnce(new Error("timeout"));
    const r = await judgePayment(input(), { ai: true });
    expect(r.status).toBe("failed");
    expect(r.outcome).toMatchObject({ verdict: "NEEDS_APPROVAL", codes: ["JUDGE_UNAVAILABLE"] });
  });
});
