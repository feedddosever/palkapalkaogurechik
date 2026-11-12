import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { PayPalError } from "@/server/paypal/types";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { paypalContract } from "./contract";

afterAll(() => closeDb());

let n = 0;
const unique = () => `${Date.now().toString(36)}-${++n}`;

function makeSim(clock?: () => Date) {
  return new SimulatedPayPal(getDb, { appUrl: "http://localhost:3000", clock });
}

describe("PayPal contract: simulator", () => {
  paypalContract(async () => {
    const gateway = makeSim();
    return { gateway, unique, approve: async (orderId) => void (await gateway.simApprove(orderId)) };
  });
});

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof PayPalError ? e.code : String(e);
  }
}

describe("simulator specifics", () => {
  async function hold(sim: SimulatedPayPal, amount = "100.00", vault = false) {
    const order = await sim.createHoldOrder({
      amount,
      currency: "USD",
      description: "d",
      customId: "c",
      returnUrl: "r",
      cancelUrl: "c",
      vault,
      requestId: unique(),
    });
    expect(order.approveUrl).toContain("/sim/paypal/checkout?token=SIM-O-");
    await sim.simApprove(order.orderId);
    return { order, auth: await sim.authorizeOrder(order.orderId, { requestId: unique() }) };
  }

  it("ids are clearly simulated and the honor period is 3 days", async () => {
    const t0 = new Date("2026-11-05T12:00:00Z");
    const sim = makeSim(() => t0);
    const { auth } = await hold(sim);
    expect(auth.authorizationId).toMatch(/^SIM-A-/);
    expect(auth.honorUntil).toBe("2026-11-08T12:00:00.000Z");
    expect(auth.expiresAt).toBe("2026-12-04T12:00:00.000Z");
  });

  it("authorizations expire after 29 days", async () => {
    let now = new Date("2026-11-05T12:00:00Z");
    const sim = makeSim(() => now);
    const { auth } = await hold(sim);
    now = new Date("2026-12-05T12:00:00Z");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "1.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("AUTHORIZATION_EXPIRED");
  });

  it("reauthorizes once, only after the honor period", async () => {
    let now = new Date("2026-11-05T12:00:00Z");
    const sim = makeSim(() => now);
    const { auth } = await hold(sim);
    expect(
      await codeOf(
        sim.reauthorize(auth.authorizationId, { amount: "100.00", currency: "USD", requestId: unique() }),
      ),
    ).toBe("REAUTHORIZATION_TOO_SOON");
    now = new Date("2026-11-09T12:00:00Z");
    const fresh = await sim.reauthorize(auth.authorizationId, {
      amount: "100.00",
      currency: "USD",
      requestId: unique(),
    });
    expect(fresh.authorizationId).not.toBe(auth.authorizationId);
    expect(fresh.honorUntil).toBe("2026-11-12T12:00:00.000Z");
    expect(
      await codeOf(
        sim.reauthorize(fresh.authorizationId, { amount: "100.00", currency: "USD", requestId: unique() }),
      ),
    ).toBe("REAUTHORIZATION_LIMIT_REACHED");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "1.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("AUTHORIZATION_VOIDED");
    expect(
      await codeOf(
        sim.reauthorize(fresh.authorizationId, { amount: "200.00", currency: "USD", requestId: unique() }),
      ),
    ).toBe("REAUTHORIZATION_LIMIT_REACHED");
  });

  it("enforces the 115% / +$75 capture ceiling", async () => {
    const sim = makeSim();
    const { auth } = await hold(sim, "100.00");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "115.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("OK");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "0.01",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("MAX_CAPTURE_AMOUNT_EXCEEDED");
    const big = await hold(sim, "1000.00");
    expect(
      await codeOf(
        sim.capture(big.auth.authorizationId, {
          amount: "1075.01",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("MAX_CAPTURE_AMOUNT_EXCEEDED");
  });

  it("rejects bad captures: currency, amount, duplicate invoice id, too many captures", async () => {
    const sim = makeSim();
    const { auth } = await hold(sim, "100.00");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "1.00",
          currency: "EUR",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("CURRENCY_MISMATCH");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "0.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("INVALID_PARAMETER_VALUE");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "abc",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("INVALID_PARAMETER_VALUE");
    const inv = `rcp_${unique()}`;
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "1.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
          invoiceId: inv,
        }),
      ),
    ).toBe("OK");
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "1.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
          invoiceId: inv,
        }),
      ),
    ).toBe("DUPLICATE_TRANSACTION");
    for (let i = 0; i < 9; i++)
      await sim.capture(auth.authorizationId, {
        amount: "1.00",
        currency: "USD",
        finalCapture: false,
        requestId: unique(),
      });
    expect(
      await codeOf(
        sim.capture(auth.authorizationId, {
          amount: "1.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("MAX_CAPTURE_COUNT_EXCEEDED");
  });

  it("void rules mirror PayPal", async () => {
    const sim = makeSim();
    const { auth } = await hold(sim, "10.00");
    await sim.voidAuthorization(auth.authorizationId, { requestId: unique() });
    expect(await codeOf(sim.voidAuthorization(auth.authorizationId, { requestId: unique() }))).toBe(
      "PREVIOUSLY_VOIDED",
    );
    const other = await hold(sim, "10.00");
    await sim.capture(other.auth.authorizationId, {
      amount: "10.00",
      currency: "USD",
      finalCapture: true,
      requestId: unique(),
    });
    expect(await codeOf(sim.voidAuthorization(other.auth.authorizationId, { requestId: unique() }))).toBe(
      "PREVIOUSLY_CAPTURED",
    );
    expect(
      await codeOf(
        sim.capture(other.auth.authorizationId, {
          amount: "1.00",
          currency: "USD",
          finalCapture: false,
          requestId: unique(),
        }),
      ),
    ).toBe("AUTHORIZATION_ALREADY_CAPTURED");
  });

  it("orders: double authorization, cancelled checkout, unknown ids", async () => {
    const sim = makeSim();
    const { order } = await hold(sim);
    expect(await codeOf(sim.authorizeOrder(order.orderId, { requestId: unique() }))).toBe(
      "ORDER_ALREADY_AUTHORIZED",
    );
    expect((await sim.getOrder(order.orderId)).status).toBe("COMPLETED");
    const cancelled = await sim.createHoldOrder({
      amount: "5.00",
      currency: "USD",
      description: "d",
      customId: "c",
      returnUrl: "r",
      cancelUrl: "c",
      requestId: unique(),
    });
    expect((await sim.simCancel(cancelled.orderId)).status).toBe("VOIDED");
    expect(await codeOf(sim.simApprove(cancelled.orderId))).toBe("ORDER_VOIDED");
    expect(await codeOf(sim.getAuthorization("SIM-A-NOPE"))).toBe("RESOURCE_NOT_FOUND");
    expect(
      await codeOf(
        sim.authorizeWithVault({
          vaultId: "SIM-V-NOPE",
          amount: "1.00",
          currency: "USD",
          description: "d",
          customId: "c",
          requestId: unique(),
        }),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
  });

  it("refunds can't exceed the capture", async () => {
    const sim = makeSim();
    const { auth } = await hold(sim, "20.00");
    const cap = await sim.capture(auth.authorizationId, {
      amount: "20.00",
      currency: "USD",
      finalCapture: true,
      requestId: unique(),
    });
    expect(
      await codeOf(
        sim.refundCapture(cap.captureId, { amount: "20.01", currency: "USD", requestId: unique() }),
      ),
    ).toBe("REFUND_AMOUNT_EXCEEDED");
    await sim.refundCapture(cap.captureId, { amount: "20.00", currency: "USD", requestId: unique() });
    expect(
      await codeOf(
        sim.refundCapture(cap.captureId, { amount: "1.00", currency: "USD", requestId: unique() }),
      ),
    ).toBe("CAPTURE_FULLY_REFUNDED");
  });

  it("payouts validate receivers and leave money to unknown accounts unclaimed", async () => {
    const sim = makeSim();
    expect(await codeOf(sim.createPayout({ senderBatchId: unique(), emailSubject: "s", items: [] }))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await codeOf(
        sim.createPayout({
          senderBatchId: unique(),
          emailSubject: "s",
          items: [
            { receiver: "not-an-email", amount: "1.00", currency: "USD", note: "n", senderItemId: "1" },
          ],
        }),
      ),
    ).toBe("RECEIVER_INVALID");
    const p = await sim.createPayout({
      senderBatchId: unique(),
      emailSubject: "s",
      items: [
        { receiver: "ghost@nowhere.invalid", amount: "1.00", currency: "USD", note: "n", senderItemId: "1" },
      ],
    });
    expect(p.items[0].status).toBe("UNCLAIMED");
  });

  it("transaction search reports holds, captures, payouts and refunds", async () => {
    const t0 = new Date("2030-01-01T00:00:00Z");
    const sim = makeSim(() => t0);
    const { auth } = await hold(sim, "30.00");
    const cap = await sim.capture(auth.authorizationId, {
      amount: "10.00",
      currency: "USD",
      finalCapture: false,
      requestId: unique(),
      invoiceId: `inv-${unique()}`,
    });
    await sim.refundCapture(cap.captureId, { amount: "2.00", currency: "USD", requestId: unique() });
    await sim.createPayout({
      senderBatchId: unique(),
      emailSubject: "s",
      items: [{ receiver: "a@b.example", amount: "10.00", currency: "USD", note: "n", senderItemId: "1" }],
    });
    const txns = await sim.searchTransactions({
      startDate: new Date("2029-12-31T00:00:00Z"),
      endDate: new Date("2030-01-02T00:00:00Z"),
    });
    expect(txns.map((t) => t.type).sort()).toEqual(["authorization", "capture", "payout", "refund"]);
    expect(txns.find((t) => t.type === "payout")!.amount.value).toBe("-10.00");
    expect(await sim.verifyWebhook()).toBe(false);
  });
});
