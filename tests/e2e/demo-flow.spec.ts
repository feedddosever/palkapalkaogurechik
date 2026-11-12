import { expect, test } from "@playwright/test";
import { AI_TIMEOUT, approveHold, expectBecBlocked, runRestock } from "./helpers";

/**
 * The whole demo story in a real browser, in a fresh isolated workspace. Zero keys: the PayPal
 * simulator and the scripted agent. Against a live deployment (E2E_BASE_URL) the same steps run on
 * PayPal's sandbox with Claude.
 */
test("rules → PayPal hold → agent run → phone approval → receipt → end of week", async ({ page }) => {
  test.setTimeout(360_000);

  await page.goto("/demo");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Give your ops agent a budget");

  // 1. Compile Dana's rules and review the Rule Card.
  await page.getByRole("button", { name: "Compile my rules" }).click();
  const card = page.getByRole("region", { name: "Compiled rules" });
  await expect(card).toBeVisible({ timeout: AI_TIMEOUT });
  await expect(card.getByText("Any single payment over $120")).toBeVisible();
  await expect(card.getByText("Buy gift cards, prepaid cards, crypto and money transfers")).toBeVisible();

  // 2. Fund the leash: approve the $500 hold (simulator, or PayPal's sandbox checkout).
  const appOrigin = new URL(page.url()).origin;
  await card.getByRole("button", { name: /fund the leash with PayPal/ }).click();
  await approveHold(page, appOrigin);
  const simulated = /token=SIM-/.test(page.url());

  // 3. Run the weekly restock and watch the live timeline; the "we changed banks" invoice is blocked
  //    (by the offline agent's own run, or by the fooled-agent replay when Claude skips it).
  await runRestock(page);
  await expect(page.getByText(/Paid \$84\.00 to Northside Roasters/).filter({ visible: true })).toBeVisible();
  await expectBecBlocked(page);

  // 4. The control tower shows the pending approval; approve it on the "phone" page.
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Control tower" })).toBeVisible();
  await expect(page.getByText("Waiting for your approval").filter({ visible: true })).toBeVisible();
  await page.getByRole("link", { name: "Review" }).first().click();
  await expect(page).toHaveURL(/\/approve\/apr_/);
  await expect(
    page
      .getByRole("region", { name: "Why Leash is asking" })
      .getByText("$141.00 is over your $120.00 approval limit."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Paid $141.00" })).toBeVisible({ timeout: 60_000 });

  // 5. The signed receipt verifies.
  await page.getByRole("link", { name: "Signed receipt" }).click();
  await expect(page.getByRole("heading", { name: "Verified" })).toBeVisible();

  // 6. End the week: the rest of the hold is released, and next week's hold is placed from the
  //    saved PayPal with no one present.
  await page.goto("/app");
  await page.getByRole("button", { name: /End week now: release \$90\.60/ }).click();
  const lastWeek = page.getByRole("status", { name: "Last week" });
  await expect(lastWeek).toContainText("$409.40 spent, $90.60 released back to your PayPal", {
    timeout: 60_000,
  });
  await expect(lastWeek).toContainText("placed automatically from your saved PayPal");
  await expect(page.getByRole("button", { name: /End week now: release \$500\.00/ })).toBeVisible();

  // 7. Every capture and payout matches PayPal's own records. (PayPal's sandbox indexes Transaction
  //    Search with a delay, so there the fresh payments may still read as pending.)
  await page.goto("/app/ledger");
  const reconciliation = page.getByRole("region", { name: "Reconciliation with PayPal" });
  if (simulated) {
    await expect(reconciliation).toContainText(
      /Reconciled with PayPal: (\d+) of \1 payments match, 0 issues/,
    );
  } else {
    await expect(reconciliation).toContainText(/Reconciled with PayPal|Couldn't reconcile with PayPal yet/);
  }
});

test("rules page shows the rules in force and their history", async ({ page }) => {
  await page.goto("/demo");
  await page.goto("/app/rules");
  await expect(page.getByRole("heading", { name: "In force now" })).toBeVisible();
  await expect(page.getByText("v1").first()).toBeVisible();
});
