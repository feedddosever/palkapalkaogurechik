import { afterAll, afterEach, describe, expect, it } from "vitest";
import { aiSpentToday, attachAiSpendStore, recordAiSpend, resetAiSpendForTesting } from "@/server/ai/budget";
import { closeDb, getDb } from "@/server/db/client";
import { aiBudgetReached, features, publicFeatureSnapshot, resetEnvForTesting } from "@/server/env";

const saved = {
  key: process.env.ANTHROPIC_API_KEY,
  budget: process.env.AI_DAILY_BUDGET_USD,
};

function configure(key: string | undefined, budget: string) {
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  process.env.AI_DAILY_BUDGET_USD = budget;
  resetEnvForTesting();
}

afterEach(() => {
  configure(saved.key, saved.budget ?? "5");
  if (saved.budget === undefined) delete process.env.AI_DAILY_BUDGET_USD;
  resetEnvForTesting();
  resetAiSpendForTesting();
});
afterAll(() => closeDb());

describe("daily AI budget", () => {
  it("switches Leash to its offline checks once today's spend reaches the budget", () => {
    configure("test-key-not-real", "1");
    expect(features.aiLive).toBe(true);

    recordAiSpend(0.6);
    expect(features.aiLive).toBe(true);
    expect(aiBudgetReached()).toBe(false);

    recordAiSpend(0.5);
    expect(aiSpentToday()).toBeCloseTo(1.1);
    expect(features.aiLive).toBe(false);
    expect(publicFeatureSnapshot().aiLive).toBe(false);
    expect(aiBudgetReached()).toBe(true);
  });

  it("ignores zero, negative and non-numeric costs", () => {
    configure("test-key-not-real", "1");
    recordAiSpend(0);
    recordAiSpend(-3);
    recordAiSpend(Number.NaN);
    expect(aiSpentToday()).toBe(0);
  });

  it("isn't 'reached' when no key is configured (that's plain offline mode)", () => {
    configure(undefined, "0");
    expect(features.aiLive).toBe(false);
    expect(aiBudgetReached()).toBe(false);
  });

  it("a budget of 0 never calls Claude", () => {
    configure("test-key-not-real", "0");
    expect(features.aiLive).toBe(false);
    expect(aiBudgetReached()).toBe(true);
  });

  it("survives a restart: today's spend is written to the database and read back", async () => {
    configure("test-key-not-real", "5");
    const db = await getDb();
    resetAiSpendForTesting();
    await attachAiSpendStore(db);
    const before = aiSpentToday();

    recordAiSpend(0.25);
    recordAiSpend(0.5);
    await new Promise((r) => setTimeout(r, 50));

    resetAiSpendForTesting(); // a fresh process: nothing in memory
    expect(aiSpentToday()).toBe(0);
    await attachAiSpendStore(db);
    expect(aiSpentToday()).toBeCloseTo(before + 0.75);
  });
});
