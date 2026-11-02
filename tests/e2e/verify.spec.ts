import { expect, test } from "@playwright/test";

test("unknown receipts are reported as not found", async ({ page }) => {
  await page.goto("/verify/rcp_does_not_exist");
  await expect(page.getByRole("heading", { name: "Receipt not found" })).toBeVisible();
});

test("public keys and receipt API respond", async ({ request }) => {
  const keys = await request.get("/.well-known/leash-keys.json");
  expect(keys.ok()).toBeTruthy();
  expect(Array.isArray((await keys.json()).keys)).toBe(true);
  expect((await request.get("/api/receipts/rcp_nope")).status()).toBe(404);
});
