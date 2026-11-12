import { describe, expect, it } from "vitest";
import { SandboxPayPal } from "@/server/paypal/sandbox";
import { PayPalError } from "@/server/paypal/types";

/**
 * Live checks against the real PayPal sandbox. Skipped unless sandbox credentials are set.
 * Cases that need a buyer to approve in the browser run in the Step 13 spike
 * (tests/unit/paypal/contract.ts against SandboxPayPal with Playwright approval).
 */
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const live = Boolean(clientId && clientSecret);
const unique = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!live)("PayPal sandbox (live)", () => {
  const pp = () => new SandboxPayPal({ clientId: clientId!, clientSecret: clientSecret! });

  it("creates an authorize-intent order with a PayPal approval link", async () => {
    const order = await pp().createHoldOrder({
      amount: "500.00",
      currency: "USD",
      description: "Leash weekly allowance (sandbox check)",
      customId: `cyc_${unique()}`,
      returnUrl: "http://localhost:3000/return",
      cancelUrl: "http://localhost:3000/cancel",
      vault: true,
      requestId: `create-${unique()}`,
    });
    expect(order.orderId).toMatch(/^[A-Z0-9]{10,}$/);
    expect(order.approveUrl).toContain("paypal.com");
    expect(["CREATED", "PAYER_ACTION_REQUIRED"]).toContain(order.status);
    expect((await pp().getOrder(order.orderId)).orderId).toBe(order.orderId);
  });

  it("refuses to authorize an order the buyer hasn't approved", async () => {
    const gateway = pp();
    const order = await gateway.createHoldOrder({
      amount: "10.00",
      currency: "USD",
      description: "x",
      customId: "c",
      returnUrl: "http://localhost:3000/r",
      cancelUrl: "http://localhost:3000/c",
      requestId: `create-${unique()}`,
    });
    const err = await gateway
      .authorizeOrder(order.orderId, { requestId: `a-${unique()}` })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).code).toBe("ORDER_NOT_APPROVED");
  });

  it("sends a payout and refuses to pay the same sender batch id twice", async () => {
    const gateway = pp();
    const receiver = process.env.PAYPAL_SANDBOX_SUPPLIER_EMAIL ?? "northside-roasters-sandbox@example.com";
    const input = {
      senderBatchId: `leash-check-${unique()}`,
      emailSubject: "Leash sandbox check",
      items: [
        { receiver, amount: "1.00", currency: "USD", note: "Leash sandbox check", senderItemId: "check-1" },
      ],
    };
    const first = await gateway.createPayout(input);
    expect(first.batchId).toBeTruthy();
    const again = await gateway.createPayout(input).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(PayPalError);
    expect((again as PayPalError).code).toBe("DUPLICATE_PAYOUT");
  });
});
