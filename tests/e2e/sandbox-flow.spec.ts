import { expect, test } from "@playwright/test";
import { buyer, compileAndFund, expectBecBlocked, runRestock } from "./helpers";

/**
 * The whole demo story on the real PayPal sandbox: the test buyer approves the hold in PayPal's
 * checkout, purchases are captured and paid out, the week ends with a void and a vault renewal.
 * Opt-in: E2E_SANDBOX=1 plus PAYPAL_CLIENT_ID/SECRET (in the app's env) and JUDGE_BUYER_EMAIL/PASSWORD.
 */
const enabled = process.env.E2E_SANDBOX === "1" && Boolean(buyer.email && buyer.password);

test.describe("PayPal sandbox", () => {
  test.skip(!enabled, "Set E2E_SANDBOX=1 with PayPal sandbox keys and the test buyer login");

  test("the demo story on real PayPal sandbox money", async ({ page, isMobile }) => {
    test.skip(isMobile, "One sandbox run is enough");
    test.setTimeout(360_000);

    await page.goto("/demo");
    await expect(page.getByRole("note", { name: "PayPal sandbox login" })).toContainText(buyer.email);
    await compileAndFund(page);
    await expect(page).toHaveURL(/\/onboarding\/funded\?token=(?!SIM-)/);

    await runRestock(page);
    await expect(
      page.getByText(/Paid \$84\.00 to Northside Roasters/).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Paid \$68\.40 to PaperGoods Supply/).filter({ visible: true }),
    ).toBeVisible();
    await expectBecBlocked(page);

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
