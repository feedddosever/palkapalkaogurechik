import { and, desc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { fromCents, normalizeAmount, toCents } from "@/lib/money";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import {
  getPayPal,
  PayPalError,
  recordPayPalOp,
  type PayPalGateway,
  type TransactionSummary,
} from "@/server/paypal";
import { closeCycle, getActiveMandate, startCycle } from "./cycles";

/**
 * Allowance cycle jobs, run by the scheduler (and by "End week now", which runs the same code):
 *  - reauthorize: after PayPal's 3-day honor period, refresh the hold so funds stay guaranteed
 *  - renew: at the end of the period, void what's left and place next period's hold from the
 *    owner's vaulted PayPal, with no one present (or ask the owner when there's no vault)
 *  - reconcile: compare every capture, payout and refund Leash recorded with PayPal's own
 *    Transaction Search, and flag anything that doesn't match
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

type Opts = { paypal?: PayPalGateway; now?: Date };

// ─── Reauthorize ────────────────────────────────────────────────────────────

export type ReauthResult =
  | { status: "reauthorized"; authorizationId: string; amount: string }
  | { status: "not_due"; reason: string }
  | { status: "skipped"; reason: string };

/** Refreshes an active hold once its honor period is over, for the amount still unspent. */
export async function reauthorizeIfDue(
  db: DB,
  cycleId: string,
  { paypal = getPayPal(), now = new Date() }: Opts = {},
): Promise<ReauthResult> {
  const [cycle] = await db.select().from(t.cycles).where(eq(t.cycles.id, cycleId));
  if (!cycle || cycle.status !== "active" || !cycle.paypalAuthorizationId)
    return { status: "not_due", reason: "No active hold." };
  if (cycle.reauthorizedAt) return { status: "not_due", reason: "Already reauthorized once." };
  if (!cycle.honorUntil || now < cycle.honorUntil)
    return { status: "not_due", reason: "Still inside PayPal's honor period." };
  if (cycle.endsAt.getTime() - now.getTime() < 12 * HOUR)
    return { status: "not_due", reason: "The period ends soon; renewal will place a fresh hold." };
  const remaining = fromCents(Math.max(0, toCents(cycle.amount) - toCents(cycle.capturedTotal)));
  if (toCents(remaining) === 0) return { status: "not_due", reason: "Nothing left to guarantee." };

  try {
    const auth = await recordPayPalOp(
      db,
      {
        workspaceId: cycle.workspaceId,
        cycleId,
        op: "reauthorize",
        mode: paypal.mode,
        requestKey: `reauth-${cycleId}`,
        amount: remaining,
      },
      () =>
        paypal.reauthorize(cycle.paypalAuthorizationId!, {
          amount: remaining,
          currency: cycle.currency,
          requestId: `reauth-${cycleId}`,
        }),
      (a) => ({ paypalId: a.authorizationId, status: a.status, debugId: a.debugId }),
    );
    await db
      .update(t.cycles)
      .set({
        paypalAuthorizationId: auth.authorizationId,
        honorUntil: auth.honorUntil ? new Date(auth.honorUntil) : null,
        expiresAt: auth.expiresAt ? new Date(auth.expiresAt) : cycle.expiresAt,
        reauthorizedAt: now,
      })
      .where(eq(t.cycles.id, cycleId));
    return { status: "reauthorized", authorizationId: auth.authorizationId, amount: remaining };
  } catch (err) {
    // The original authorization stays valid for 29 days; captures still work, just without
    // PayPal's guarantee. Recorded in paypal_operations; nothing else to do.
    return {
      status: "skipped",
      reason: err instanceof PayPalError ? `${err.code}: ${err.message}` : String(err),
    };
  }
}

// ─── Renew ──────────────────────────────────────────────────────────────────

export type RenewResult = {
  closed: typeof t.cycles.$inferSelect;
  /** The next hold, already active when it was placed from a vaulted PayPal. */
  next: typeof t.cycles.$inferSelect | null;
  /** Without a vault, the owner approves the next hold here. */
  approveUrl?: string;
  how: "vault" | "owner" | "none";
  reason?: string;
};

/**
 * Ends a cycle and starts the next one. With the owner's saved PayPal (vault), the next hold is
 * placed merchant-initiated, with no one present, using the CURRENT rules' amount. Idempotent.
 */
export async function renewCycle(
  db: DB,
  cycleId: string,
  { paypal = getPayPal(), now = new Date(), placeNext = true }: Opts & { placeNext?: boolean } = {},
): Promise<RenewResult> {
  const [already] = await db.select().from(t.cycles).where(eq(t.cycles.previousCycleId, cycleId));
  const closed = await closeCycle(db, cycleId, { paypal });
  if (already) return { closed, next: already, how: "vault" };
  if (!placeNext) return { closed, next: null, how: "none", reason: "Not renewed." };

  if (!closed.paypalVaultId) {
    const started = await startCycle(db, {
      workspaceId: closed.workspaceId,
      agentId: closed.agentId,
      paypal,
      now,
    });
    const [next] = await db.select().from(t.cycles).where(eq(t.cycles.id, started.cycleId));
    return { closed, next, approveUrl: started.approveUrl, how: "owner" };
  }

  const mandate = await getActiveMandate(db, closed.agentId);
  const amount = normalizeAmount(mandate.policy.cycle.amount);
  const days = mandate.policy.cycle.period === "weekly" ? 7 : 30;
  const nextId = newId("cyc");
  await db.insert(t.cycles).values({
    id: nextId,
    workspaceId: closed.workspaceId,
    agentId: closed.agentId,
    mandateId: mandate.id,
    amount,
    status: "pending_approval",
    startsAt: now,
    endsAt: new Date(now.getTime() + days * DAY),
    paypalVaultId: closed.paypalVaultId,
    previousCycleId: closed.id,
  });
  try {
    const auth = await recordPayPalOp(
      db,
      {
        workspaceId: closed.workspaceId,
        cycleId: nextId,
        op: "authorize_order",
        mode: paypal.mode,
        requestKey: `renew-${closed.id}`,
        amount,
      },
      () =>
        paypal.authorizeWithVault({
          vaultId: closed.paypalVaultId!,
          amount,
          currency: "USD",
          description: `Leash ${mandate.policy.cycle.period} allowance (renewed)`,
          customId: nextId,
          requestId: `renew-${closed.id}`,
        }),
      (a) => ({ paypalId: a.authorizationId, status: a.status, debugId: a.debugId }),
    );
    const [next] = await db
      .update(t.cycles)
      .set({
        status: "active",
        paypalOrderId: auth.orderId ?? null,
        paypalAuthorizationId: auth.authorizationId,
        authorizedAt: now,
        honorUntil: auth.honorUntil ? new Date(auth.honorUntil) : null,
        expiresAt: auth.expiresAt ? new Date(auth.expiresAt) : null,
      })
      .where(eq(t.cycles.id, nextId))
      .returning();
    return { closed, next, how: "vault" };
  } catch (err) {
    // The vault no longer works (revoked, expired…): fall back to asking the owner.
    await db.update(t.cycles).set({ status: "failed" }).where(eq(t.cycles.id, nextId));
    const started = await startCycle(db, {
      workspaceId: closed.workspaceId,
      agentId: closed.agentId,
      paypal,
      now,
    });
    const [next] = await db.select().from(t.cycles).where(eq(t.cycles.id, started.cycleId));
    return {
      closed,
      next,
      approveUrl: started.approveUrl,
      how: "owner",
      reason: err instanceof PayPalError ? `${err.code}: ${err.message}` : String(err),
    };
  }
}

// ─── Reconcile ──────────────────────────────────────────────────────────────

const MONEY_OPS = ["capture", "payout", "refund"] as const;

/** Transaction Search can lag behind real time (PayPal documents up to 3 hours). */
export function settleWindowMs(mode: "sandbox" | "sim") {
  return mode === "sandbox" ? 3 * HOUR : 0;
}

const abs = (v: string) => Math.abs(toCents(v.replace(/^-/, "")));

/**
 * Matches every money-moving PayPal operation Leash recorded in this workspace against PayPal's
 * Transaction Search, and flags captures from this workspace's holds that Leash never made.
 */
export async function reconcileWorkspace(
  db: DB,
  workspaceId: string,
  {
    paypal = getPayPal(),
    now = new Date(),
    days = 7,
    transactions,
  }: Opts & { days?: number; transactions?: TransactionSummary[] } = {},
) {
  const rangeStart = new Date(now.getTime() - days * DAY);
  let txns: TransactionSummary[];
  try {
    txns = transactions ?? (await paypal.searchTransactions({ startDate: rangeStart, endDate: now }));
  } catch (err) {
    // Typically NOT_AUTHORIZED: the PayPal app doesn't have the Transaction Search permission yet.
    const [row] = await db
      .insert(t.reconciliations)
      .values({
        id: newId("rcn"),
        workspaceId,
        mode: paypal.mode,
        rangeStart,
        rangeEnd: now,
        checked: 0,
        matched: 0,
        pending: 0,
        issues: [
          {
            kind: "search_unavailable",
            paypalId: "",
            note:
              err instanceof PayPalError && err.code === "NOT_AUTHORIZED"
                ? "PayPal's Transaction Search isn't enabled for this PayPal app yet, so Leash can't compare its records with PayPal's."
                : `PayPal's Transaction Search didn't answer (${err instanceof PayPalError ? err.code : "network error"}).`,
          },
        ],
        createdAt: now,
      })
      .returning();
    return row;
  }
  const ours = await db
    .select()
    .from(t.paypalOperations)
    .where(
      and(
        eq(t.paypalOperations.workspaceId, workspaceId),
        inArray(t.paypalOperations.op, [...MONEY_OPS]),
        ne(t.paypalOperations.status, "ERROR"),
        isNotNull(t.paypalOperations.paypalId),
        gte(t.paypalOperations.createdAt, rangeStart),
        lte(t.paypalOperations.createdAt, now),
      ),
    );

  const issues: t.ReconciliationIssue[] = [];
  let matched = 0;
  let pending = 0;
  for (const op of ours) {
    const hits =
      op.op === "payout"
        ? txns.filter((x) => x.type === "payout" && (x.refId === op.paypalId || x.id === op.paypalId))
        : txns.filter((x) => x.id === op.paypalId);
    if (hits.length === 0) {
      if (now.getTime() - op.createdAt.getTime() < settleWindowMs(paypal.mode)) pending++;
      else
        issues.push({
          kind: "missing_in_paypal",
          op: op.op,
          paypalId: op.paypalId!,
          ours: op.amount ?? undefined,
          note: `Leash recorded this ${op.op}, but PayPal's transaction search doesn't show it.`,
        });
      continue;
    }
    const paypalCents = hits.reduce((a, x) => a + abs(x.amount.value), 0);
    if (op.amount && paypalCents !== toCents(op.amount)) {
      issues.push({
        kind: "amount_mismatch",
        op: op.op,
        paypalId: op.paypalId!,
        ours: op.amount,
        paypal: fromCents(paypalCents),
        note: `Leash recorded $${op.amount}; PayPal shows $${fromCents(paypalCents)}.`,
      });
    } else matched++;
  }

  // Captures against THIS workspace's holds that Leash never made: someone else drew on the hold.
  // (Other cafés' anomalies stay in their own reports.)
  const holds = new Set(
    (
      await db
        .select({ id: t.paypalOperations.paypalId })
        .from(t.paypalOperations)
        .where(
          and(
            eq(t.paypalOperations.workspaceId, workspaceId),
            inArray(t.paypalOperations.op, ["authorize_order", "reauthorize"]),
            isNotNull(t.paypalOperations.paypalId),
          ),
        )
    ).map((r) => r.id),
  );
  const recorded = new Set(
    (
      await db
        .select({ id: t.paypalOperations.paypalId })
        .from(t.paypalOperations)
        .where(and(eq(t.paypalOperations.op, "capture"), isNotNull(t.paypalOperations.paypalId)))
    ).map((r) => r.id),
  );
  for (const x of txns) {
    if (x.type !== "capture" || !x.refId || !holds.has(x.refId) || recorded.has(x.id)) continue;
    issues.push({
      kind: "unknown_in_paypal",
      paypalId: x.id,
      paypal: fromCents(abs(x.amount.value)),
      note: `PayPal shows a $${fromCents(abs(x.amount.value))} capture from your hold that Leash didn't make.`,
    });
  }

  const [row] = await db
    .insert(t.reconciliations)
    .values({
      id: newId("rcn"),
      workspaceId,
      mode: paypal.mode,
      rangeStart,
      rangeEnd: now,
      checked: ours.length,
      matched,
      pending,
      issues,
      createdAt: now,
    })
    .returning();
  return row;
}

export async function latestReconciliation(db: DB, workspaceId: string) {
  const [row] = await db
    .select()
    .from(t.reconciliations)
    .where(eq(t.reconciliations.workspaceId, workspaceId))
    .orderBy(desc(t.reconciliations.createdAt))
    .limit(1);
  return row ?? null;
}

// ─── The scheduled tick ─────────────────────────────────────────────────────

export type JobsReport = {
  reauthorized: string[];
  renewed: { cycleId: string; nextCycleId: string | null; how: RenewResult["how"] }[];
  closedIdle: string[];
  reconciled: { workspaceId: string; checked: number; matched: number; issues: number }[];
  errors: { cycleId?: string; workspaceId?: string; error: string }[];
};

/**
 * One pass over every hold. Lab and bench sandboxes are skipped; an idle agent's budget is closed,
 * not renewed (Leash doesn't renew money nobody used).
 */
export async function runCycleJobs(
  db: DB,
  { paypal = getPayPal(), now = new Date() }: Opts = {},
): Promise<JobsReport> {
  const report: JobsReport = { reauthorized: [], renewed: [], closedIdle: [], reconciled: [], errors: [] };
  const active = await db
    .select({ cycle: t.cycles, kind: t.workspaces.kind })
    .from(t.cycles)
    .innerJoin(t.workspaces, eq(t.workspaces.id, t.cycles.workspaceId))
    .where(eq(t.cycles.status, "active"));

  for (const { cycle, kind } of active) {
    if (kind !== "demo") continue;
    try {
      if (cycle.endsAt <= now) {
        const [run] = await db
          .select({ id: t.agentRuns.id })
          .from(t.agentRuns)
          .where(and(eq(t.agentRuns.agentId, cycle.agentId), gte(t.agentRuns.startedAt, cycle.startsAt)))
          .limit(1);
        const out = await renewCycle(db, cycle.id, { paypal, now, placeNext: Boolean(run) });
        if (out.how === "none") report.closedIdle.push(cycle.id);
        else report.renewed.push({ cycleId: cycle.id, nextCycleId: out.next?.id ?? null, how: out.how });
      } else {
        const r = await reauthorizeIfDue(db, cycle.id, { paypal, now });
        if (r.status === "reauthorized") report.reauthorized.push(cycle.id);
      }
    } catch (err) {
      report.errors.push({ cycleId: cycle.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // One Transaction Search call for the whole account, then per-workspace matching.
  const since = new Date(now.getTime() - 7 * DAY);
  const busy = await db
    .selectDistinct({ workspaceId: t.paypalOperations.workspaceId })
    .from(t.paypalOperations)
    .innerJoin(t.workspaces, eq(t.workspaces.id, t.paypalOperations.workspaceId))
    .where(and(gte(t.paypalOperations.createdAt, since), eq(t.workspaces.kind, "demo")));
  if (busy.length) {
    try {
      const transactions = await paypal.searchTransactions({ startDate: since, endDate: now });
      for (const { workspaceId } of busy) {
        const r = await reconcileWorkspace(db, workspaceId, { paypal, now, transactions });
        report.reconciled.push({
          workspaceId,
          checked: r.checked,
          matched: r.matched,
          issues: r.issues.length,
        });
      }
    } catch (err) {
      report.errors.push({ error: `Reconciliation: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return report;
}
