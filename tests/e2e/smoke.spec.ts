import { expect, test } from "@playwright/test";

test("health endpoint reports a working database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(["pglite", "postgres"]).toContain(body.db);
});

test("landing page renders the pitch and the leash meter", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Let your AI agent spend");
  await expect(page.getByRole("img", { name: /spent/ })).toBeVisible();
  await expect(page.getByLabel("Integration status")).toBeVisible();
});
