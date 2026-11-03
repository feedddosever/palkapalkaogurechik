import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import {
  decideProposal,
  demoteOnAttack,
  eligibility,
  openProposal,
  refreshProposal,
  shortenLeash,
  trackRecord,
  type Record_,
} from "@/server/trust/engine";
import { provisionWorkspace } from "@/server/workspace";

afterAll(() => closeDb());

const record = (over: Partial<Record_> = {}): Record_ => ({
  level: 1,
  windowDays: 28,
  since: new Date("2026-10-06T00:00:00Z"),
  executed: 20,
  approvalsGranted: 0,
  denials: 0,
  blocks: 0,
  avgVsMarketPct: -5,
  savings: "40.00",
  lastDemotion: null,
  ...over,
});

const level = async (agentId: string) => {
  const db = await getDb();
  return (await db.select().from(t.agents).where(eq(t.agents.id, agentId)))[0].autonomyLevel;
};

describe("eligibility", () => {
  it("L1 → L2 needs 15 clean payments and nothing blocked or denied", () => {
    expect(eligibility(record())).toEqual({ eligible: true, nextLevel: 2, missing: [] });
    expect(eligibility(record({ executed: 10 })).missing).toEqual(["5 more clean payments"]);
    expect(eligibility(record({ blocks: 1 })).eligible).toBe(false);
    expect(eligibility(record({ denials: 2 })).missing[0]).toContain("no denied requests");
  });

  it("L2 → L3 also needs approvals from the owner; L4 is the top", () => {
    expect(eligibility(record({ level: 2, executed: 30 })).missing).toEqual(["3 more approvals from you"]);
    expect(eligibility(record({ level: 4 })).nextLevel).toBeNull();
    expect(eligibility(record({ level: 0, executed: 3 })).eligible).toBe(true);
  });
});

describe("trust engine on a seeded café", () => {
  it("four clean weeks at L1 earn a proposal for L2, opened once", async () => {
    const { agentId } = await provisionWorkspace("demo");
    const db = await getDb();
    const rec = await trackRecord(db, agentId);
    expect(rec).toMatchObject({ level: 1, executed: 20, blocks: 0, denials: 0 });
    expect(rec.avgVsMarketPct).toBeLessThan(0);

    const p = await refreshProposal(db, agentId, { ai: false });
    expect(p).toMatchObject({ kind: "proposed", status: "open", fromLevel: 1, toLevel: 2 });
    expect(p!.reason).toBe("Give Ops agent a longer leash: move to L2 Budgeted?");
    expect((await refreshProposal(db, agentId, { ai: false }))!.id).toBe(p!.id);

    expect(await decideProposal(db, p!.id, "accept")).toEqual({ level: 2 });
    expect(await level(agentId)).toBe(2);
    const promoted = await db
      .select()
      .from(t.trustEvents)
      .where(and(eq(t.trustEvents.agentId, agentId), eq(t.trustEvents.kind, "promoted")));
    expect(promoted).toHaveLength(1);
    expect(await decideProposal(db, p!.id, "accept")).toBeNull();
  });

  it("declining keeps the level", async () => {
    const { agentId } = await provisionWorkspace("demo");
    const db = await getDb();
    const p = await refreshProposal(db, agentId, { ai: false });
    expect(await decideProposal(db, p!.id, "decline")).toEqual({ level: 1 });
    expect(await level(agentId)).toBe(1);
  });

  it("a blocked attack closes the open proposal and restarts the clock, even at L0", async () => {
    const { workspaceId, agentId } = await provisionWorkspace("demo");
    const db = await getDb();
    await refreshProposal(db, agentId, { ai: false });
    expect(await demoteOnAttack(db, { workspaceId, agentId, requestId: "req_x", reason: "BEC" })).toEqual({
      from: 1,
      to: 0,
    });
    expect(await openProposal(db, agentId)).toBeNull();
    const rec = await trackRecord(db, agentId);
    expect(rec.executed).toBe(0);
    expect(rec.lastDemotion?.reason).toBe("BEC");
    expect(eligibility(rec).missing).toEqual(["3 more clean payments"]);
    expect(await refreshProposal(db, agentId, { ai: false })).toBeNull();

    expect(await demoteOnAttack(db, { workspaceId, agentId, requestId: "req_y", reason: "again" })).toEqual({
      from: 0,
      to: 0,
    });
    const demotions = await db
      .select()
      .from(t.trustEvents)
      .where(and(eq(t.trustEvents.agentId, agentId), eq(t.trustEvents.kind, "demoted")));
    expect(demotions).toHaveLength(2);
  });

  it("the owner can shorten the leash any time, but not lengthen it that way", async () => {
    const { agentId } = await provisionWorkspace("demo");
    const db = await getDb();
    expect(await shortenLeash(db, agentId, 0)).toEqual({ from: 1, to: 0 });
    expect(await shortenLeash(db, agentId, 3)).toEqual({ from: 0, to: 0 });
    expect(await level(agentId)).toBe(0);
  });
});
