/**
 * Tops up the sandbox test buyer's PayPal balance with a Payout from the sandbox merchant account.
 * Every demo story captures about $409 from the buyer's hold, so the balance runs down; when it can't
 * cover a $500 hold, PayPal adds a funding step (and for EU accounts a SEPA mandate) to the checkout.
 *
 *   npm run sandbox:topup -- 3000        (USD, default 2000)
 *
 * Sandbox only: needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET and JUDGE_BUYER_EMAIL.
 */
import { env, features } from "@/server/env";
import { SandboxPayPal } from "@/server/paypal/sandbox";

async function main() {
  const amount = Number(process.argv[2] ?? 2000);
  if (!features.paypalLive)
    throw new Error("Not configured for the PayPal sandbox (PAYPAL_CLIENT_ID/SECRET).");
  if (!env.JUDGE_BUYER_EMAIL) throw new Error("Set JUDGE_BUYER_EMAIL to the sandbox buyer's login.");
  if (!(amount > 0 && amount <= 10_000)) throw new Error("Amount must be between 0 and 10,000.");

  const paypal = new SandboxPayPal({
    clientId: env.PAYPAL_CLIENT_ID!,
    clientSecret: env.PAYPAL_CLIENT_SECRET!,
  });
  const batchId = `topup-${Date.now()}`;
  const payout = await paypal.createPayout({
    senderBatchId: batchId,
    emailSubject: "Leash sandbox: test buyer top-up",
    items: [
      {
        receiver: env.JUDGE_BUYER_EMAIL,
        amount: amount.toFixed(2),
        currency: "USD",
        note: "Sandbox top-up so the demo's $500 holds come out of the PayPal balance.",
        senderItemId: `${batchId}-1`,
      },
    ],
  });
  console.log(`Payout ${payout.batchId}: ${payout.status}`);
  for (let i = 0; i < 10 && !["SUCCESS", "DENIED", "CANCELED"].includes(payout.status); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const now = await paypal.getPayout(payout.batchId);
    console.log(`  ${now.status}`);
    if (["SUCCESS", "DENIED", "CANCELED"].includes(now.status)) break;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
