/**
 * Step 13 verification spike against the real PayPal sandbox. Answers the questions the simulator
 * can only assume, through Leash's own SandboxPayPal client:
 *   1. several partial captures (final_capture=false) on one PayPal-wallet authorization
 *   2. void after partial captures; reauthorize before the honor period; errors after void
 *   3. a vaulted PayPal wallet: does a merchant-initiated order authorize with no buyer present?
 *   4. payout replay for a repeated sender_batch_id
 *   5. invoice_id uniqueness on captures
 *   + Transaction Search access
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… JUDGE_BUYER_EMAIL=… JUDGE_BUYER_PASSWORD=… \
 *   npx tsx scripts/spike-paypal.ts [--vault] [--shots=DIR]
 *
 * The buyer approves in PayPal's sandbox checkout, driven by Playwright. Prints a JSON report.
 */
import { chromium } from "playwright";
import { SandboxPayPal } from "@/server/paypal/sandbox";
import { PayPalError } from "@/server/paypal/types";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v;
};
const pp = new SandboxPayPal({
  clientId: need("PAYPAL_CLIENT_ID"),
  clientSecret: need("PAYPAL_CLIENT_SECRET"),
});
const buyer = { email: need("JUDGE_BUYER_EMAIL"), password: need("JUDGE_BUYER_PASSWORD") };
const withVault = process.argv.includes("--vault");
const shots = process.argv.find((a) => a.startsWith("--shots="))?.slice(8);
const run = `spk-${Date.now().toString(36)}`;
const RETURN = "https://example.com/leash/return";
const CANCEL = "https://example.com/leash/cancel";

type Step = { step: string; ok: boolean; detail: unknown };
const report: Step[] = [];
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn();
    report.push({ step: name, ok: true, detail: out });
    console.error(`✓ ${name}`);
    return out;
  } catch (err) {
    const detail =
      err instanceof PayPalError
        ? { code: err.code, message: err.message, status: err.httpStatus, debugId: err.debugId }
        : { error: err instanceof Error ? err.message : String(err) };
    report.push({ step: name, ok: false, detail });
    console.error(`✗ ${name}: ${JSON.stringify(detail)}`);
    return undefined;
  }
}

/** Approves an order in PayPal's sandbox checkout as the test buyer. */
async function approve(approveUrl: string, label: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const snap = (n: string) =>
    shots ? page.screenshot({ path: `${shots}/${label}-${n}.png` }).catch(() => undefined) : undefined;
  try {
    await page.goto(approveUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await snap("1-open");
    const email = page.locator("#email");
    if (await email.isVisible().catch(() => false)) {
      await email.fill(buyer.email);
      const next = page.locator("#btnNext");
      if (await next.isVisible().catch(() => false)) await next.click();
      await page.locator("#password").waitFor({ timeout: 20_000 });
      await page.locator("#password").fill(buyer.password);
      await snap("2-login");
      await page.locator("#btnLogin").click();
    }
    // Review page: click whichever confirm button this checkout version shows.
    const deadline = Date.now() + 90_000;
    while (!page.url().startsWith(RETURN) && Date.now() < deadline) {
      for (const sel of [
        "#payment-submit-btn",
        "button[data-testid='submit-button-initial']",
        "button:has-text('Continue')",
        "button:has-text('Agree & Continue')",
        "button:has-text('Complete Purchase')",
      ]) {
        const b = page.locator(sel).first();
        if (await b.isVisible().catch(() => false)) {
          await snap("3-review");
          await b.click().catch(() => undefined);
          break;
        }
      }
      await page.waitForTimeout(1500);
    }
    await snap("4-after");
    if (!page.url().startsWith(RETURN))
      throw new Error(`Buyer approval didn't finish (at ${page.url().split("?")[0]})`);
    return { returnedTo: RETURN, payerId: new URL(page.url()).searchParams.get("PayerID") };
  } finally {
    await browser.close();
  }
}

async function main() {
  // ── A hold the buyer approves ──
  const order = await step("create AUTHORIZE order ($500)", () =>
    pp.createHoldOrder({
      amount: "500.00",
      currency: "USD",
      description: "Leash weekly allowance (spike)",
      customId: `cyc_${run}`,
      returnUrl: RETURN,
      cancelUrl: CANCEL,
      vault: withVault,
      requestId: `order-${run}`,
    }),
  );
  if (!order?.approveUrl) return finish();
  const approved = await step("buyer approves in sandbox checkout", () => approve(order.approveUrl!, "hold"));
  if (!approved) return finish();
  const auth = await step("authorize the order", () =>
    pp.authorizeOrder(order.orderId, { requestId: `auth-${run}` }),
  );
  if (!auth) return finish();

  // ── Q1: several partial captures ──
  const captures: string[] = [];
  for (const [i, amount] of ["84.00", "116.00", "68.40"].entries()) {
    const c = await step(`partial capture ${i + 1} ($${amount}, final_capture=false)`, () =>
      pp.capture(auth.authorizationId, {
        amount,
        currency: "USD",
        finalCapture: false,
        requestId: `cap-${run}-${i}`,
        invoiceId: `rcp_${run}_${i}`,
      }),
    );
    if (c) captures.push(c.captureId);
  }
  await step("capture retry with the same PayPal-Request-Id (expect replay, no new capture)", async () => {
    const again = await pp.capture(auth.authorizationId, {
      amount: "84.00",
      currency: "USD",
      finalCapture: false,
      requestId: `cap-${run}-0`,
      invoiceId: `rcp_${run}_0`,
    });
    return { captureId: again.captureId, sameAsFirst: again.captureId === captures[0] };
  });
  // ── Q5: invoice_id uniqueness ──
  await step("capture reusing an invoice_id (Q5)", () =>
    pp.capture(auth.authorizationId, {
      amount: "1.00",
      currency: "USD",
      finalCapture: false,
      requestId: `cap-${run}-dupinv`,
      invoiceId: `rcp_${run}_0`,
    }),
  );
  await step("authorization after captures", () => pp.getAuthorization(auth.authorizationId));
  // ── Q2: reauthorize too soon, void the rest, then try again ──
  await step("reauthorize inside the honor period (Q2, expect refusal)", () =>
    pp.reauthorize(auth.authorizationId, { amount: "231.60", currency: "USD", requestId: `reauth-${run}` }),
  );
  await step("void the remainder after partial captures (Q2)", () =>
    pp.voidAuthorization(auth.authorizationId, { requestId: `void-${run}` }),
  );
  await step("capture after void (expect refusal)", () =>
    pp.capture(auth.authorizationId, {
      amount: "1.00",
      currency: "USD",
      finalCapture: false,
      requestId: `cap-${run}-aftervoid`,
    }),
  );
  await step("authorization after void", () => pp.getAuthorization(auth.authorizationId));

  // ── Payouts + Q4 replay ──
  const payoutInput = {
    senderBatchId: `pay-${run}`,
    emailSubject: "Leash spike payout",
    items: [
      {
        receiver: process.env.PAYPAL_SANDBOX_SUPPLIER_EMAIL ?? "northside-roasters-sandbox@example.com",
        amount: "84.00",
        currency: "USD",
        note: "Leash spike",
        senderItemId: `item-${run}`,
      },
    ],
  };
  const payout = await step("payout to a supplier", () => pp.createPayout(payoutInput));
  await step("payout again with the same sender_batch_id (Q4)", () => pp.createPayout(payoutInput));
  if (payout) await step("payout status", () => pp.getPayout(payout.batchId));

  // ── Transaction Search ──
  await step("transaction search (last 2 days)", async () => {
    const now = new Date();
    const txns = await pp.searchTransactions({
      startDate: new Date(now.getTime() - 2 * 86400000),
      endDate: now,
    });
    return { count: txns.length, sample: txns.slice(0, 3) };
  });

  // ── Q3: vaulted wallet, merchant-initiated authorization ──
  if (withVault && auth.vaultId) {
    await step("merchant-initiated authorize from the vault (Q3)", () =>
      pp.authorizeWithVault({
        vaultId: auth.vaultId!,
        amount: "500.00",
        currency: "USD",
        description: "Leash weekly allowance (renewal spike)",
        customId: `cyc_${run}_next`,
        requestId: `renew-${run}`,
      }),
    );
  } else if (withVault) {
    report.push({
      step: "vault id returned on authorization (Q3)",
      ok: false,
      detail: { vaultId: auth.vaultId ?? null },
    });
  }
  finish();
}

function finish() {
  console.log(JSON.stringify({ run, vault: withVault, report }, null, 2));
}

main().catch((err) => {
  console.error(err);
  finish();
  process.exit(1);
});
