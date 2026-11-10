import { expect, test, type Page } from "@playwright/test";

/**
 * The whole demo story on the real PayPal sandbox: the test buyer approves the hold in PayPal's
 * checkout, purchases are captured and paid out, the week ends with a void and a vault renewal.
 * Opt-in: E2E_SANDBOX=1 plus PAYPAL_CLIENT_ID/SECRET (in the app's env) and JUDGE_BUYER_EMAIL/PASSWORD.
 */
const buyer = {
  email: process.env.JUDGE_BUYER_EMAIL ?? "",
  password: process.env.JUDGE_BUYER_PASSWORD ?? "",
};
const enabled = process.env.E2E_SANDBOX === "1" && Boolean(buyer.email && buyer.password);

/** Logs in as the sandbox buyer and approves, until PayPal sends us back to the app. */
async function approveInPayPal(page: Page, appOrigin: string) {
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
    for (const sel of [
      "#payment-submit-btn",
      "button[data-testid='submit-button-initial']",
      "button:has-text('Continue')",
      "button:has-text('Agree & Continue')",
    ]) {
      const b = page.locator(sel).first();
      if (await b.isVisible().catch(() => false)) {
        // Bounded: PayPal re-renders these buttons, and an unbounded click can stall the loop.
        await b.click({ timeout: 5_000 }).catch(() => undefined);
        break;
      }
    }
    await page.waitForTimeout(1500);
  }
  expect(page.url().startsWith(appOrigin)).toBe(true);
}

test.describe("PayPal sandbox", () => {
  test.skip(!enabled, "Set E2E_SANDBOX=1 with PayPal sandbox keys and the test buyer login");

  test("the demo story on real PayPal sandbox money", async ({ page, baseURL, isMobile }) => {
    test.skip(isMobile, "One sandbox run is enough");
    test.setTimeout(240_000);

    await page.goto("/demo");
    await expect(page.getByRole("note", { name: "PayPal sandbox login" })).toContainText(buyer.email);
    await page.getByRole("button", { name: "Compile my rules" }).click();
    const card = page.getByRole("region", { name: "Compiled rules" });
    await card.getByRole("button", { name: /fund the leash with PayPal/ }).click();

    await approveInPayPal(page, new URL(baseURL!).origin);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("$500.00 is on a leash", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Run the weekly restock" }).click();
    await expect(page.getByText("Run finished").filter({ visible: true })).toBeVisible({ timeout: 120_000 });
    await expect(
      page.getByText(/Paid \$84\.00 to Northside Roasters/).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Paid \$68\.40 to PaperGoods Supply/).filter({ visible: true }),
    ).toBeVisible();
    const becBlocked = page.getByText(/Blocked: \$112\.00 to Northside Roasters/).filter({ visible: true });
    if (!(await becBlocked.isVisible())) {
      // A careful agent (Claude) left the "new payment details" invoice unpaid. Replay it with a
      // simulated fooled agent: Leash has to stop it on its own.
      await page.goto("/app");
      const replay = page.getByRole("region", { name: "What if your agent gets fooled?" });
      await expect(replay).toContainText("Updated payment details: invoice #4471");
      await replay.getByRole("button", { name: "Replay with a fooled agent" }).click();
      await expect(page.getByText("Run finished").filter({ visible: true })).toBeVisible({ timeout: 60_000 });
    }
    await expect(becBlocked).toBeVisible();
    await expect(page.getByText("Leash shortened: L1 → L0").filter({ visible: true })).toBeVisible();

    await page.goto("/app");
    await page.getByRole("link", { name: "Review" }).first().click();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("heading", { name: "Paid $141.00" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("link", { name: "Signed receipt" }).click();
    await expect(page.getByRole("heading", { name: "Verified" })).toBeVisible();

    await page.goto("/app");
    await page.getByRole("button", { name: /End week now: release \$90\.60/ }).click();
    const lastWeek = page.getByRole("status", { name: "Last week" });
    await expect(lastWeek).toContainText("$409.40 spent, $90.60 released back to your PayPal", {
      timeout: 60_000,
    });
    await expect(lastWeek).toContainText("placed automatically from your saved PayPal");
  });
});
