import { expect, test, type Page } from "@playwright/test";
import { AI_TIMEOUT, compileAndFund, expectBecBlocked, runRestock } from "./helpers";

async function fundAndRun(page: Page) {
  await compileAndFund(page);
  await runRestock(page);
  await expectBecBlocked(page);
}

test("ledger: AG Grid with presets and plain-English questions", async ({ page }) => {
  test.setTimeout(360_000);
  await fundAndRun(page);
  await page.goto("/app/ledger");
  const grid = page.getByRole("treegrid").or(page.getByRole("grid")).first();
  await expect(grid).toBeVisible();
  await expect(grid.getByText("Velvet Espresso Blend", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "Stopped by Leash" }).click();
  await expect(grid.getByText("Invoice 4471")).toBeVisible();
  await expect(grid.getByText("Invoice PG-2231")).toHaveCount(0);

  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByLabel(/Ask the ledger/).fill("waiting payments over $100");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  // The offline parser says "Showing waiting for you, over $100."; Claude words it its own way.
  await expect(page.getByRole("status").filter({ hasText: /waiting/i })).toBeVisible({ timeout: AI_TIMEOUT });
  await expect(grid.getByText("6× Barista Oat Milk", { exact: false })).toBeVisible();
  await expect(grid.getByText("Invoice 4471")).toHaveCount(0);
});
