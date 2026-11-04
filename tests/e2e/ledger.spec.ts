import { expect, test, type Page } from "@playwright/test";

async function fundAndRun(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Compile my rules" }).click();
  await page.getByRole("button", { name: /fund the leash with PayPal/ }).click();
  await page.getByRole("button", { name: /Approve \$500\.00 hold/ }).click();
  await page.getByRole("button", { name: "Run the weekly restock" }).click();
  await expect(page.getByText("Run finished").filter({ visible: true })).toBeVisible({ timeout: 30_000 });
}

test("ledger: AG Grid with presets and plain-English questions", async ({ page }) => {
  test.setTimeout(90_000);
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
  await expect(
    page.getByRole("status").filter({ hasText: "Showing waiting for you, over $100." }),
  ).toBeVisible();
  await expect(grid.getByText("6× Barista Oat Milk", { exact: false })).toBeVisible();
  await expect(grid.getByText("Invoice 4471")).toHaveCount(0);
});
