import { expect, test } from "@playwright/test";

test("trust: a clean track record earns a proposal; the owner lengthens the leash", async ({ page }) => {
  await page.goto("/demo");
  await page.goto("/app/trust");
  await expect(page.getByRole("heading", { name: "Leash length" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Give Ops agent a longer leash: move to L2 Budgeted?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lengthen the leash" }).click();
  await expect(page.getByText("Lengthened L1 → L2")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "current" })).toContainText("Budgeted");
  await page.getByRole("button", { name: "Shorten the leash to L0" }).click();
  await expect(page.getByText("Shortened L2 → L0")).toBeVisible();
});
