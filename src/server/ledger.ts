import { and, asc, eq, inArray } from "drizzle-orm";
import { multiplyAmount, toCents } from "@/lib/money";
import { marketQuoteFor } from "@/server/catalog";
import { getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { isSeededCycle } from "@/server/seed/seed";

/**
 * The ledger: every PayPal hold and every payment the agent asked for, one row each,
 * flattened for AG Grid. "spent" is only set when money actually moved, so totals stay honest.
 */
export type LedgerRow = {
  id: string;
  date: string;
  /** ISO date of the Monday starting that week (sortable; formatted in the grid). */
  week: string;
  event: "Purchase" | "Invoice" | "PayPal hold" | "Hold reauthorized" | "Hold released";
  supplier: string;
  category: string;
  description: string;
  amount: number;
  spent: number | null;
  status: "Paid" | "Waiting for you" | "Blocked" | "Denied" | "Failed" | "Approved" | "Held" | "Released";
  decidedBy: string;
  reason: string;
  vsMarketPct: number | null;
  saved: number | null;
  /** This supplier's weekly spend over the last five weeks (sparkline). */
  trend: number[];
  requestId: string | null;
  receiptId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  payoutBatchId: string | null;
  runId: string | null;
  historical: boolean;
};

const STATUS: Record<string, LedgerRow["status"]> = {
  executed: "Paid",
  needs_approval: "Waiting for you",
  blocked: "Blocked",
  denied: "Denied",
  failed: "Failed",
  approved: "Approved",
  executing: "Approved",
  pending: "Waiting for you",
};

const CATEGORY_LABEL: Record<string, string> = {
  coffee: "Coffee",
  dairy_alt: "Plant milk",
  packaging: "Packaging",
  cleaning: "Cleaning",
  gift_cards: "Gift cards",
  prepaid_cards: "Prepaid cards",
  invoice: "Invoice",
};

export function weekStart(d: Date): string {
  const day = d.getUTCDay();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

export async function ledgerRows(workspaceId: string): Promise<LedgerRow[]> {
  const db = await getDb();
  const [requests, cycles] = await Promise.all([
    db
      .select()
      .from(t.paymentRequests)
      .where(eq(t.paymentRequests.workspaceId, workspaceId))
      .orderBy(asc(t.paymentRequests.createdAt)),
    db
      .select()
      .from(t.cycles)
      .where(and(eq(t.cycles.workspaceId, workspaceId), inArray(t.cycles.status, ["active", "closed"]))),
  ]);
  const ids = requests.map((r) => r.id);
  const [layers, receipts, ops] = ids.length
    ? await Promise.all([
        db.select().from(t.guardDecisions).where(inArray(t.guardDecisions.requestId, ids)),
        db
          .select({ id: t.receipts.id, requestId: t.receipts.requestId })
          .from(t.receipts)
          .where(inArray(t.receipts.requestId, ids)),
        db.select().from(t.paypalOperations).where(inArray(t.paypalOperations.requestId, ids)),
      ])
    : [[], [], []];

  // Weekly spend per supplier for the sparklines.
  const weeks = [...new Set(requests.map((r) => weekStart(r.createdAt)))].sort().slice(-5);
  const spendBySupplierWeek = new Map<string, Map<string, number>>();
  for (const r of requests.filter((x) => x.status === "executed")) {
    const m = spendBySupplierWeek.get(r.supplierName) ?? new Map<string, number>();
    const w = weekStart(r.createdAt);
    m.set(w, (m.get(w) ?? 0) + Number(r.amount));
    spendBySupplierWeek.set(r.supplierName, m);
  }
  const trendFor = (supplier: string) =>
    weeks.map((w) => Math.round((spendBySupplierWeek.get(supplier)?.get(w) ?? 0) * 100) / 100);

  const rows: LedgerRow[] = [];
  for (const r of requests) {
    const combined = layers.find((l) => l.requestId === r.id && l.layer === "combined");
    const opsFor = ops.filter((o) => o.requestId === r.id && o.status !== "ERROR");
    const cycle = cycles.find((c) => c.id === r.cycleId);
    let vsMarketPct: number | null = null;
    let saved: number | null = null;
    if (r.kind === "purchase" && r.items.length) {
      let marketCents = 0;
      let paidCents = 0;
      for (const i of r.items) {
        const q = await marketQuoteFor({ sku: i.sku, category: i.category, title: i.name });
        if (!q) continue;
        marketCents += toCents(multiplyAmount(q.median, i.quantity));
        paidCents += toCents(multiplyAmount(i.unitPrice, i.quantity));
      }
      if (marketCents > 0) {
        vsMarketPct = Math.round((paidCents / marketCents - 1) * 1000) / 10;
        if (r.status === "executed") saved = Math.round(marketCents - paidCents) / 100;
      }
    }
    const status = STATUS[r.status] ?? "Failed";
    rows.push({
      id: r.id,
      date: r.createdAt.toISOString(),
      week: weekStart(r.createdAt),
      event: r.kind === "invoice" ? "Invoice" : "Purchase",
      supplier: r.supplierName,
      category:
        r.kind === "invoice"
          ? "Invoice"
          : (CATEGORY_LABEL[r.items[0]?.category ?? ""] ?? r.items[0]?.category ?? "Other"),
      description:
        r.kind === "invoice"
          ? `Invoice ${r.invoiceNumber ?? ""}`.trim()
          : r.items.map((i) => `${i.quantity}× ${i.name}`).join(", "),
      amount: Number(r.amount),
      spent: r.status === "executed" ? Number(r.amount) : null,
      status,
      decidedBy: r.historical ? "rules" : (combined?.codes.join(" + ") ?? "") || "rules",
      reason: r.historical
        ? "Within your rules (earlier week)"
        : (combined?.reasons[0] ?? "Within your rules"),
      vsMarketPct,
      saved,
      trend: trendFor(r.supplierName),
      requestId: r.id,
      receiptId: receipts.find((x) => x.requestId === r.id)?.id ?? null,
      authorizationId: cycle?.paypalAuthorizationId ?? null,
      captureId: opsFor.find((o) => o.op === "capture")?.paypalId ?? null,
      payoutBatchId: opsFor.find((o) => o.op === "payout")?.paypalId ?? null,
      runId: r.runId,
      historical: r.historical,
    });
  }

  const reauths = cycles.length
    ? await db
        .select()
        .from(t.paypalOperations)
        .where(
          and(
            inArray(
              t.paypalOperations.cycleId,
              cycles.map((c) => c.id),
            ),
            eq(t.paypalOperations.op, "reauthorize"),
          ),
        )
    : [];

  for (const c of cycles) {
    const base = {
      supplier: "PayPal",
      category: "Budget",
      spent: null,
      decidedBy: "owner",
      vsMarketPct: null,
      saved: null,
      trend: [],
      requestId: null,
      receiptId: null,
      authorizationId: c.paypalAuthorizationId,
      captureId: null,
      payoutBatchId: null,
      runId: null,
      historical: isSeededCycle(c),
    };
    const placed = c.authorizedAt ?? c.startsAt;
    rows.push({
      ...base,
      id: `${c.id}-hold`,
      date: placed.toISOString(),
      week: weekStart(placed),
      event: "PayPal hold",
      description: `Weekly allowance held in PayPal (${c.paypalAuthorizationId ?? "pending"})`,
      amount: Number(c.amount),
      status: "Held",
      reason: c.previousCycleId
        ? "Renewed automatically from the owner's saved PayPal (no one present)"
        : "Approved by the owner in PayPal",
    });
    const reauth = reauths.find((o) => o.cycleId === c.id && o.status !== "ERROR");
    if (c.reauthorizedAt && reauth) {
      rows.push({
        ...base,
        id: `${c.id}-reauth`,
        date: c.reauthorizedAt.toISOString(),
        week: weekStart(c.reauthorizedAt),
        event: "Hold reauthorized",
        description: `Hold refreshed after PayPal's 3-day honor period (${c.paypalAuthorizationId})`,
        amount: Number(reauth.amount ?? 0),
        status: "Held",
        reason: "Keeps the remaining budget guaranteed by PayPal",
      });
    }
    if (c.status === "closed" && c.closedAt) {
      rows.push({
        ...base,
        id: `${c.id}-release`,
        date: c.closedAt.toISOString(),
        week: weekStart(c.closedAt),
        event: "Hold released",
        description: `Unused budget voided back to the owner`,
        amount: Number(c.releasedTotal),
        status: "Released",
        reason: `Captured $${c.capturedTotal}, released $${c.releasedTotal}`,
      });
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
