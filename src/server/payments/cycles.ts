import { and, desc, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { fromCents, normalizeAmount, toCents } from "@/lib/money";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { env } from "@/server/env";
import { PolicySchema } from "@/server/guard/policy";
import { getPayPal, recordPayPalOp, type PayPalGateway } from "@/server/paypal";

/**
 * A cycle is one PayPal authorization hold the agent draws down:
 *   start (create order; owner approves in PayPal) → activate (authorize) → captures… → close (void rest)
 */

const DAY = 24 * 60 * 60 * 1000;

export async function getActiveMandate(db: DB, agentId: string) {
  const [m] = await db
    .select()
    .from(t.mandates)
    .where(and(eq(t.mandates.agentId, agentId), eq(t.mandates.status, "active")))
    .orderBy(desc(t.mandates.version))
    .limit(1);
  if (!m) throw new Error(`No active rules for agent ${agentId}`);
  return { ...m, policy: PolicySchema.parse(m.policy) };
}

export async function getActiveCycle(db: DB, agentId: string) {
  const [c] = await db
    .select()
    .from(t.cycles)
    .where(and(eq(t.cycles.agentId, agentId), eq(t.cycles.status, "active")))
    .orderBy(desc(t.cycles.startsAt))
    .limit(1);
  return c ?? null;
}

/** Creates the PayPal order for this cycle's hold. The owner approves it at `approveUrl`. */
export async function startCycle(
  db: DB,
  {
    workspaceId,
    agentId,
    returnUrl = `${env.APP_URL}/onboarding/funded`,
    cancelUrl = `${env.APP_URL}/onboarding`,
    vault = true,
    paypal = getPayPal(),
    now = new Date(),
  }: {
    workspaceId: string;
    agentId: string;
    returnUrl?: string;
    cancelUrl?: string;
    vault?: boolean;
    paypal?: PayPalGateway;
    now?: Date;
  },
) {
  const mandate = await getActiveMandate(db, agentId);
  const amount = normalizeAmount(mandate.policy.cycle.amount);
  const days = mandate.policy.cycle.period === "weekly" ? 7 : 30;
  const cycleId = newId("cyc");
  await db.insert(t.cycles).values({
    id: cycleId,
    workspaceId,
    agentId,
    mandateId: mandate.id,
    amount,
    status: "pending_approval",
    startsAt: now,
    endsAt: new Date(now.getTime() + days * DAY),
  });
  const order = await recordPayPalOp(
    db,
    { workspaceId, cycleId, op: "create_order", mode: paypal.mode, requestKey: `order-${cycleId}`, amount },
    () =>
      paypal.createHoldOrder({
        amount,
        currency: "USD",
        description: `Leash ${mandate.policy.cycle.period} allowance for your ops agent`,
        customId: cycleId,
        returnUrl,
        cancelUrl,
        vault,
        brandName: "Leash",
        requestId: `order-${cycleId}`,
      }),
    (o) => ({ paypalId: o.orderId, status: o.status, debugId: o.debugId }),
  );
  await db.update(t.cycles).set({ paypalOrderId: order.orderId }).where(eq(t.cycles.id, cycleId));
  return { cycleId, orderId: order.orderId, approveUrl: order.approveUrl, amount };
}

/** After the owner approves in PayPal: authorize the order. The hold becomes the agent's budget. */
export async function activateCycle(db: DB, cycleId: string, { paypal = getPayPal() } = {}) {
  const [cycle] = await db.select().from(t.cycles).where(eq(t.cycles.id, cycleId));
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`);
  if (cycle.status === "active") return cycle;
  if (cycle.status !== "pending_approval" || !cycle.paypalOrderId) {
    throw new Error(`Cycle ${cycleId} can't be activated from ${cycle.status}`);
  }
  const auth = await recordPayPalOp(
    db,
    {
      workspaceId: cycle.workspaceId,
      cycleId,
      op: "authorize_order",
      mode: paypal.mode,
      requestKey: `auth-${cycleId}`,
      amount: cycle.amount,
    },
    () => paypal.authorizeOrder(cycle.paypalOrderId!, { requestId: `auth-${cycleId}` }),
    (a) => ({ paypalId: a.authorizationId, status: a.status, debugId: a.debugId }),
  );
  // Only one active hold per agent: close any previous one first.
  const previous = await getActiveCycle(db, cycle.agentId);
  if (previous && previous.id !== cycleId) await closeCycle(db, previous.id, { paypal });
  const [updated] = await db
    .update(t.cycles)
    .set({
      status: "active",
      paypalAuthorizationId: auth.authorizationId,
      paypalVaultId: auth.vaultId,
      authorizedAt: new Date(),
      honorUntil: auth.honorUntil ? new Date(auth.honorUntil) : null,
      expiresAt: auth.expiresAt ? new Date(auth.expiresAt) : null,
    })
    .where(eq(t.cycles.id, cycleId))
    .returning();
  return updated;
}

/** Ends the cycle: voids the unused part of the hold so the owner's money is released in PayPal. */
export async function closeCycle(db: DB, cycleId: string, { paypal = getPayPal() } = {}) {
  const [cycle] = await db.select().from(t.cycles).where(eq(t.cycles.id, cycleId));
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`);
  if (cycle.status === "closed") return cycle;
  const released = fromCents(Math.max(0, toCents(cycle.amount) - toCents(cycle.capturedTotal)));
  if (cycle.paypalAuthorizationId && toCents(released) > 0) {
    await recordPayPalOp(
      db,
      {
        workspaceId: cycle.workspaceId,
        cycleId,
        op: "void",
        mode: paypal.mode,
        requestKey: `void-${cycleId}`,
        amount: released,
      },
      () => paypal.voidAuthorization(cycle.paypalAuthorizationId!, { requestId: `void-${cycleId}` }),
      (a) => ({ paypalId: a.authorizationId, status: a.status, debugId: a.debugId }),
    );
  }
  const [updated] = await db
    .update(t.cycles)
    .set({ status: "closed", releasedTotal: released, closedAt: new Date() })
    .where(eq(t.cycles.id, cycleId))
    .returning();
  return updated;
}
