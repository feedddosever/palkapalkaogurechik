import { expect, it } from "vitest";
import { PayPalError, type PayPalGateway } from "@/server/paypal/types";

/**
 * Behaviour Leash relies on, written once and run against BOTH gateways:
 *  - the simulator (always, in unit tests)
 *  - the real PayPal sandbox (Step 13 spike, when credentials + a sandbox buyer exist)
 * If the sandbox disagrees with a case here, the plan's fallback ladder decides what changes.
 */
export type ContractSetup = () => Promise<{
  gateway: PayPalGateway;
  /** Has the payer approve the order (sim: direct; sandbox: browser automation). */
  approve: (orderId: string, approveUrl?: string) => Promise<void>;
  unique: () => string;
}>;

async function expectPayPalError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PayPalError);
  expect((err as PayPalError).code).toBe(code);
}

export function paypalContract(setup: ContractSetup) {
  async function hold(amount = "500.00", vault = false) {
    const { gateway, approve, unique } = await setup();
    const order = await gateway.createHoldOrder({
      amount,
      currency: "USD",
      description: "Leash weekly allowance",
      customId: `cyc_${unique()}`,
      returnUrl: "http://localhost:3000/return",
      cancelUrl: "http://localhost:3000/cancel",
      vault,
      requestId: `create-${unique()}`,
    });
    expect(order.orderId).toBeTruthy();
    expect(order.approveUrl).toBeTruthy();
    await approve(order.orderId, order.approveUrl);
    const auth = await gateway.authorizeOrder(order.orderId, { requestId: `auth-${unique()}` });
    return { gateway, unique, order, auth };
  }

  it("an order cannot be authorized before the payer approves it", async () => {
    const { gateway, unique } = await setup();
    const order = await gateway.createHoldOrder({
      amount: "10.00",
      currency: "USD",
      description: "x",
      customId: "c",
      returnUrl: "http://localhost/r",
      cancelUrl: "http://localhost/c",
      requestId: `create-${unique()}`,
    });
    await expectPayPalError(
      gateway.authorizeOrder(order.orderId, { requestId: `a-${unique()}` }),
      "ORDER_NOT_APPROVED",
    );
  });

  it("an approved order becomes an authorization hold for the full amount", async () => {
    const { auth } = await hold("500.00");
    expect(auth.status).toBe("CREATED");
    expect(auth.amount).toEqual({ value: "500.00", currency: "USD" });
    expect(new Date(auth.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 28 * 864e5);
  });

  it("supports several partial captures against one hold, then voiding the rest", async () => {
    const { gateway, unique, auth } = await hold("500.00");
    const c1 = await gateway.capture(auth.authorizationId, {
      amount: "84.00",
      currency: "USD",
      finalCapture: false,
      requestId: `c-${unique()}`,
    });
    const c2 = await gateway.capture(auth.authorizationId, {
      amount: "116.00",
      currency: "USD",
      finalCapture: false,
      requestId: `c-${unique()}`,
    });
    expect(c1.status).toBe("COMPLETED");
    expect(c2.captureId).not.toBe(c1.captureId);
    expect((await gateway.getAuthorization(auth.authorizationId)).status).toBe("PARTIALLY_CAPTURED");

    const voided = await gateway.voidAuthorization(auth.authorizationId, { requestId: `v-${unique()}` });
    expect(voided.status).toBe("VOIDED");
    await expectPayPalError(
      gateway.capture(auth.authorizationId, {
        amount: "1.00",
        currency: "USD",
        finalCapture: false,
        requestId: `c-${unique()}`,
      }),
      "AUTHORIZATION_VOIDED",
    );
  });

  it("a retried capture with the same PayPal-Request-Id is not charged twice", async () => {
    const { gateway, unique, auth } = await hold("100.00");
    const key = `c-${unique()}`;
    const a = await gateway.capture(auth.authorizationId, {
      amount: "40.00",
      currency: "USD",
      finalCapture: false,
      requestId: key,
    });
    const b = await gateway.capture(auth.authorizationId, {
      amount: "40.00",
      currency: "USD",
      finalCapture: false,
      requestId: key,
    });
    expect(b.captureId).toBe(a.captureId);
    const c = await gateway.capture(auth.authorizationId, {
      amount: "60.00",
      currency: "USD",
      finalCapture: true,
      requestId: `c-${unique()}`,
    });
    expect(c.status).toBe("COMPLETED");
    expect((await gateway.getAuthorization(auth.authorizationId)).status).toBe("CAPTURED");
  });

  it("refuses to capture more than PayPal allows over the hold", async () => {
    const { gateway, unique, auth } = await hold("100.00");
    await expectPayPalError(
      gateway.capture(auth.authorizationId, {
        amount: "200.00",
        currency: "USD",
        finalCapture: false,
        requestId: `c-${unique()}`,
      }),
      "MAX_CAPTURE_AMOUNT_EXCEEDED",
    );
  });

  it("refunds part of a capture", async () => {
    const { gateway, unique, auth } = await hold("50.00");
    const cap = await gateway.capture(auth.authorizationId, {
      amount: "20.00",
      currency: "USD",
      finalCapture: false,
      requestId: `c-${unique()}`,
    });
    const refund = await gateway.refundCapture(cap.captureId, {
      amount: "5.00",
      currency: "USD",
      requestId: `r-${unique()}`,
    });
    expect(refund.amount).toEqual({ value: "5.00", currency: "USD" });
  });

  it("pays a supplier with Payouts, and a retried batch is not paid twice", async () => {
    const { gateway, unique } = await setup();
    const batch = `batch-${unique()}`;
    const input = {
      senderBatchId: batch,
      emailSubject: "Payment from Bean There Café",
      items: [
        {
          receiver: "billing@northside-roasters.example",
          amount: "84.00",
          currency: "USD",
          note: "Espresso ×2",
          senderItemId: "req_1",
        },
      ],
    };
    const p1 = await gateway.createPayout(input);
    const p2 = await gateway.createPayout(input);
    expect(p1.batchId).toBeTruthy();
    expect(p2.batchId).toBe(p1.batchId);
    expect((await gateway.getPayout(p1.batchId)).items[0].amount.value).toBe("84.00");
  });

  it("a saved PayPal wallet can place the next hold with no payer present", async () => {
    const { gateway, unique, auth } = await hold("500.00", true);
    expect(auth.vaultId).toBeTruthy();
    const next = await gateway.authorizeWithVault({
      vaultId: auth.vaultId!,
      amount: "500.00",
      currency: "USD",
      description: "Leash weekly allowance (renewal)",
      customId: `cyc_${unique()}`,
      requestId: `renew-${unique()}`,
    });
    expect(next.status).toBe("CREATED");
    expect(next.authorizationId).not.toBe(auth.authorizationId);
  });
}
