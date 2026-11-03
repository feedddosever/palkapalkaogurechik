import { and, desc, eq, inArray, max } from "drizzle-orm";
import { cookies } from "next/headers";
import { fromCents, multiplyAmount, toCents } from "@/lib/money";
import { marketQuoteFor } from "@/server/catalog";
import { getDb, type DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { PolicySchema } from "@/server/guard/policy";
import { ruleCardFromPolicy, type RuleCard } from "@/server/guard/rule-card";
import type { AutonomyLevel } from "@/server/guard/types";
import { DEMO_SUPPLIERS } from "@/server/catalog/demo-suppliers";
import { isSeededCycle } from "@/server/seed/seed";
import { openProposal } from "@/server/trust/engine";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "@/server/workspace";

/** Read models for the UI. Every query is scoped to the caller's workspace. */

export const WORKSPACE_COOKIE = "leash_ws";

/** The workspace for this browser session (judge mode sets the cookie; otherwise the default). */
export async function currentWorkspaceId(): Promise<string> {
  // Request data first: it marks the render as dynamic before any database work starts.
  const fromCookie = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const db = await getDb();
  if (fromCookie && fromCookie !== DEFAULT_WORKSPACE_ID) {
    const [ws] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.id, fromCookie));
    if (ws) return ws.id;
  }
  return ensureDefaultWorkspace();
}

export async function workspaceBasics(db: DB, workspaceId: string) {
  const [business] = await db.select().from(t.businesses).where(eq(t.businesses.workspaceId, workspaceId));
  const [agent] = await db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  return { business, agent };
}

export const supplierNames = Object.fromEntries(DEMO_SUPPLIERS.map((s) => [s.slug, s.name]));

export async function activeRules(
  db: DB,
  agentId: string,
): Promise<{ id: string; ownerText: string; ruleCard: RuleCard; version: number; createdAt: Date } | null> {
  const [m] = await db
    .select()
    .from(t.mandates)
    .where(and(eq(t.mandates.agentId, agentId), eq(t.mandates.status, "active")))
    .orderBy(desc(t.mandates.version))
    .limit(1);
  if (!m) return null;
  return {
    id: m.id,
    ownerText: m.ownerText,
    version: m.version,
    createdAt: m.createdAt,
    ruleCard: ruleCardFromPolicy(PolicySchema.parse(m.policy), supplierNames),
  };
}

export async function nextMandateVersion(db: DB, agentId: string): Promise<number> {
  const [row] = await db
    .select({ v: max(t.mandates.version) })
    .from(t.mandates)
    .where(eq(t.mandates.agentId, agentId));
  return (row?.v ?? 0) + 1;
}

export type RequestView = {
  id: string;
  kind: "purchase" | "invoice";
  supplierName: string;
  payeeEmail: string;
  amount: string;
  status: string;
  verdict: string | null;
  summary: string;
  reasons: string[];
  createdAt: Date;
  approvalId?: string;
  receiptId?: string;
  runId: string | null;
};

export async function recentRequests(db: DB, workspaceId: string, limit = 12): Promise<RequestView[]> {
  const rows = await db
    .select()
    .from(t.paymentRequests)
    .where(and(eq(t.paymentRequests.workspaceId, workspaceId), eq(t.paymentRequests.historical, false)))
    .orderBy(desc(t.paymentRequests.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [combined, approvals, receipts] = await Promise.all([
    db
      .select()
      .from(t.guardDecisions)
      .where(and(inArray(t.guardDecisions.requestId, ids), eq(t.guardDecisions.layer, "combined"))),
    db.select().from(t.approvals).where(inArray(t.approvals.requestId, ids)),
    db
      .select({ id: t.receipts.id, requestId: t.receipts.requestId })
      .from(t.receipts)
      .where(inArray(t.receipts.requestId, ids)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    supplierName: r.supplierName,
    payeeEmail: r.payeeEmail,
    amount: r.amount,
    status: r.status,
    verdict: r.verdict,
    summary:
      r.kind === "invoice"
        ? `Invoice ${r.invoiceNumber ?? ""}`.trim()
        : r.items.map((i) => `${i.quantity}× ${i.name}`).join(", "),
    reasons: combined.find((c) => c.requestId === r.id)?.reasons ?? [],
    createdAt: r.createdAt,
    approvalId: approvals.find((a) => a.requestId === r.id)?.id,
    receiptId: receipts.find((x) => x.requestId === r.id)?.id,
    runId: r.runId,
  }));
}

export async function dashboard(workspaceId: string) {
  const db = await getDb();
  const { business, agent } = await workspaceBasics(db, workspaceId);
  const [cycle] = await db
    .select()
    .from(t.cycles)
    .where(and(eq(t.cycles.agentId, agent.id), inArray(t.cycles.status, ["active", "pending_approval"])))
    .orderBy(desc(t.cycles.createdAt))
    .limit(1);
  const requests = await recentRequests(db, workspaceId, 12);
  const inCycle = cycle
    ? await db.select().from(t.paymentRequests).where(eq(t.paymentRequests.cycleId, cycle.id))
    : [];
  const pending = requests.filter((r) => r.status === "needs_approval");
  const pendingCents = inCycle
    .filter((r) => r.status === "needs_approval")
    .reduce((a, r) => a + toCents(r.amount), 0);

  // Savings vs Channel3 market median for executed purchases this cycle.
  let savedCents = 0;
  for (const r of inCycle.filter((x) => x.status === "executed" && x.kind === "purchase")) {
    for (const i of r.items) {
      const q = await marketQuoteFor({ sku: i.sku, category: i.category, title: i.name });
      if (q)
        savedCents += Math.max(
          0,
          toCents(multiplyAmount(q.median, i.quantity)) - toCents(multiplyAmount(i.unitPrice, i.quantity)),
        );
    }
  }
  const [lastRun] = await db
    .select()
    .from(t.agentRuns)
    .where(eq(t.agentRuns.agentId, agent.id))
    .orderBy(desc(t.agentRuns.startedAt))
    .limit(1);
  const rules = await activeRules(db, agent.id);
  const [lastTrust] = await db
    .select()
    .from(t.trustEvents)
    .where(eq(t.trustEvents.agentId, agent.id))
    .orderBy(desc(t.trustEvents.createdAt))
    .limit(1);
  // The week that just ended (shown for a few days after it closes).
  const [lastClosed] = await db
    .select()
    .from(t.cycles)
    .where(and(eq(t.cycles.agentId, agent.id), eq(t.cycles.status, "closed")))
    .orderBy(desc(t.cycles.closedAt))
    .limit(1);
  const recentlyClosed =
    lastClosed?.closedAt &&
    !isSeededCycle(lastClosed) &&
    Date.now() - lastClosed.closedAt.getTime() < 3 * 24 * 60 * 60 * 1000
      ? { ...lastClosed, renewedByVault: cycle?.previousCycleId === lastClosed.id }
      : null;

  return {
    business,
    agent: { ...agent, level: agent.autonomyLevel as AutonomyLevel },
    cycle: cycle
      ? {
          ...cycle,
          held: Number(cycle.amount),
          spent: Number(cycle.capturedTotal),
          pending: pendingCents / 100,
          remaining: fromCents(Math.max(0, toCents(cycle.amount) - toCents(cycle.capturedTotal))),
        }
      : null,
    stats: {
      paid: inCycle.filter((r) => r.status === "executed").length,
      waiting: inCycle.filter((r) => r.status === "needs_approval").length,
      blocked: inCycle.filter((r) => r.status === "blocked").length,
      saved: fromCents(savedCents),
    },
    pending,
    requests,
    lastRun: lastRun ?? null,
    rules,
    lastTrust: lastTrust ?? null,
    proposal: await openProposal(db, agent.id),
    lastClosed: recentlyClosed,
  };
}

export async function approvalView(approvalId: string) {
  const db = await getDb();
  const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.id, approvalId));
  if (!approval) return null;
  const [req] = await db.select().from(t.paymentRequests).where(eq(t.paymentRequests.id, approval.requestId));
  const layers = await db.select().from(t.guardDecisions).where(eq(t.guardDecisions.requestId, req.id));
  const { business, agent } = await workspaceBasics(db, req.workspaceId);
  const [cycle] = await db
    .select()
    .from(t.cycles)
    .where(and(eq(t.cycles.agentId, agent.id), eq(t.cycles.status, "active")));
  const [receipt] = await db
    .select({ id: t.receipts.id })
    .from(t.receipts)
    .where(eq(t.receipts.requestId, req.id));
  const market: { name: string; median: string; unitPrice: string }[] = [];
  for (const i of req.items) {
    const q = await marketQuoteFor({ sku: i.sku, category: i.category, title: i.name });
    if (q) market.push({ name: i.name, median: q.median, unitPrice: i.unitPrice });
  }
  return {
    approval,
    request: req,
    layers: layers.filter((l) => l.layer !== "combined"),
    combined: layers.find((l) => l.layer === "combined") ?? null,
    business,
    agent,
    remaining: cycle ? fromCents(toCents(cycle.amount) - toCents(cycle.capturedTotal)) : null,
    receiptId: receipt?.id,
    market,
  };
}

export async function runView(runId: string) {
  const db = await getDb();
  const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
  return run ?? null;
}

export async function mandateHistory(db: DB, agentId: string) {
  return db
    .select({
      id: t.mandates.id,
      version: t.mandates.version,
      status: t.mandates.status,
      ownerText: t.mandates.ownerText,
      createdAt: t.mandates.createdAt,
    })
    .from(t.mandates)
    .where(eq(t.mandates.agentId, agentId))
    .orderBy(desc(t.mandates.version));
}
