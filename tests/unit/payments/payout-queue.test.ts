import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { activateCycle, startCycle } from "@/server/payments/cycles";
import { sendQueuedPayouts, submitPaymentRequest } from "@/server/payments/service";
import type { PayoutInput } from "@/server/paypal/types";
import { PayPalError } from "@/server/paypal/types";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { provisionWorkspace } from "@/server/workspace";

/** The simulator, but PayPal says the merchant's funds haven't cleared for the first payouts. */
class UnclearedFunds extends SimulatedPayPal {
  refusals = 1;
  override async createPayout(input: PayoutInput) {
    if (this.refusals > 0) {
      this.refusals--;
      throw new PayPalError("INSUFFICIENT_FUNDS", "Sender does not have sufficient funds.", 422);
    }
    return super.createPayout(input);
  }
}

const paypal = new UnclearedFunds(getDb, { appUrl: "http://localhost:3000" });

afterAll(() => closeDb());

describe("supplier payouts while PayPal clears the funds", () => {
  it("keeps the payment paid, queues the payout, and sends it on a later tick exactly once", async () => {
    const db = await getDb();
    const ws = await provisionWorkspace("demo");
    const { cycleId, orderId } = await startCycle(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      paypal,
    });
    await paypal.simApprove(orderId);
    await activateCycle(db, cycleId, { paypal });

    const r = await submitPaymentRequest(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      agentTask: "Weekly restock",
      ai: false,
      paypal,
      input: {
        kind: "purchase",
        items: [{ productId: "ns-espresso-5lb", quantity: 2 }],
        justification: "Espresso is 2 below par",
        sourceIds: [],
      },
    });
    expect(r.status).toBe("executed");
    expect(r.execution).toMatchObject({ ok: true, payoutQueued: true });
    const queued = () =>
      db
        .select()
        .from(t.paypalOperations)
        .where(and(eq(t.paypalOperations.requestId, r.requestId), eq(t.paypalOperations.op, "payout")));
    expect((await queued()).map((o) => o.status)).toEqual(expect.arrayContaining(["ERROR", "QUEUED"]));

    // Still not cleared: stays queued.
    paypal.refusals = 1;
    expect(await sendQueuedPayouts(db, { paypal })).toMatchObject({ sent: [], stillQueued: 1 });

    // Cleared: the payout goes out once, then there's nothing left to send.
    expect((await sendQueuedPayouts(db, { paypal })).sent).toEqual([r.requestId]);
    expect((await queued()).map((o) => o.status)).not.toContain("QUEUED");
    expect((await sendQueuedPayouts(db, { paypal })).sent).toEqual([]);
  });
});
