import { expect, type Page } from "@playwright/test";

/**
 * Shared steps for the demo story. They work against both setups: the zero-key build (PayPal
 * simulator, scripted agent) and a live deployment (PayPal sandbox checkout, Claude).
 */

export const buyer = {
  email: process.env.JUDGE_BUYER_EMAIL ?? "",
  password: process.env.JUDGE_BUYER_PASSWORD ?? "",
};

/** Claude compiling rules or running the agent takes longer than the offline fallbacks. */
export const AI_TIMEOUT = 60_000;
export const RUN_TIMEOUT = 180_000;

/**
 * PayPal's approve buttons, in the buyer account's language. When the buyer's balance doesn't cover
 * the hold, PayPal adds a funding step and (for EU accounts) a SEPA mandate dialog with the same
 * button, so the last visible match is the one to press.
 */
const PAYPAL_SUBMIT =
  /^(pay now|continue|agree (&|and) continue|complete purchase|accetta e continua|continua|paga ora|accetta e paga)$/i;

async function clickPayPalSubmit(page: Page) {
  for (const sel of ["#payment-submit-btn", "button[data-testid='submit-button-initial']"]) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      // Bounded: PayPal re-renders these buttons, and an unbounded click can stall the loop.
      await b.click({ timeout: 5_000 }).catch(() => undefined);
      return;
    }
  }
  const named = page.getByRole("button", { name: PAYPAL_SUBMIT });
  for (let i = (await named.count().catch(() => 0)) - 1; i >= 0; i--) {
    const b = named.nth(i);
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 5_000 }).catch(() => undefined);
      return;
    }
  }
}

/** Logs in as the sandbox buyer and approves, until PayPal sends the browser back to the app. */
export async function approveInPayPal(page: Page, appOrigin: string) {
  await page.waitForURL(/sandbox\.paypal\.com/, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const email = page.locator("#email");
  if (await email.isVisible().catch(() => false)) {
    await email.fill(buyer.email);
    const next = page.locator("#btnNext");
    if (await next.isVisible().catch(() => false)) await next.click({ timeout: 10_000 });
    await page.locator("#password").waitFor({ timeout: 20_000 });
    await page.locator("#password").fill(buyer.password);
    await page.locator("#btnLogin").click({ timeout: 10_000 });
  }
  const deadline = Date.now() + 90_000;
  while (!page.url().startsWith(appOrigin) && Date.now() < deadline) {
    await clickPayPalSubmit(page);
    await page.waitForTimeout(1500);
  }
  expect(page.url().startsWith(appOrigin)).toBe(true);
}

/** Approves the $500 hold: one click on the simulator, or the test buyer's login on PayPal's sandbox. */
export async function approveHold(page: Page, appOrigin: string) {
  await page.waitForURL(/\/sim\/paypal\/checkout|sandbox\.paypal\.com/, { timeout: 30_000 });
  if (/sandbox\.paypal\.com/.test(page.url())) {
    if (!buyer.email || !buyer.password) {
      throw new Error(
        "This deployment uses the PayPal sandbox: set JUDGE_BUYER_EMAIL and JUDGE_BUYER_PASSWORD",
      );
    }
    await approveInPayPal(page, appOrigin);
  } else {
    await page.getByRole("button", { name: /Approve \$500\.00 hold/ }).click();
  }
  await expect(page.getByRole("heading", { level: 1 })).toContainText("$500.00 is on a leash", {
    timeout: 30_000,
  });
}

/** A fresh café: compile the default rules, then fund the leash. Returns the Rule Card. */
export async function compileAndFund(page: Page) {
  await page.goto("/demo");
  const appOrigin = new URL(page.url()).origin;
  await page.getByRole("button", { name: "Compile my rules" }).click();
  const card = page.getByRole("region", { name: "Compiled rules" });
  await expect(card).toBeVisible({ timeout: AI_TIMEOUT });
  await card.getByRole("button", { name: /fund the leash with PayPal/ }).click();
  await approveHold(page, appOrigin);
  return card;
}

/** Runs the weekly restock from the funded page and waits for the run to finish. */
export async function runRestock(page: Page) {
  await page.getByRole("button", { name: "Run the weekly restock" }).click();
  await expect(page).toHaveURL(/\/app\/runs\/run_/);
  await expect(page.getByText("Run finished").filter({ visible: true })).toBeVisible({
    timeout: RUN_TIMEOUT,
  });
}

/**
 * Makes sure the "we changed banks" invoice was tried and blocked. The offline agent falls for it
 * in the restock run; a careful agent (Claude) leaves it unpaid, so the test replays it with the
 * simulated fooled agent from the control tower. Ends on the run page that shows the block.
 */
export async function expectBecBlocked(page: Page) {
  const blocked = page.getByText(/Blocked: \$112\.00 to Northside Roasters/).filter({ visible: true });
  if (!(await blocked.isVisible())) {
    await page.goto("/app");
    const replay = page.getByRole("region", { name: "What if your agent gets fooled?" });
    await expect(replay).toContainText("Updated payment details: invoice #4471");
    await replay.getByRole("button", { name: "Replay with a fooled agent" }).click();
    await expect(page.getByText("Simulated fooled agent").filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Run finished").filter({ visible: true })).toBeVisible({ timeout: 60_000 });
  }
  await expect(blocked).toBeVisible();
  await expect(page.getByText("Leash shortened: L1 → L0").filter({ visible: true })).toBeVisible();
}
