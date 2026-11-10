import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility (WCAG 2.1 AA, axe-core) and console errors on the pages judges see. Serious and
 * critical violations fail the test.
 */
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // AG Grid's own markup is checked by AG Grid; its virtualized rows trip axe's region rules.
    .exclude(".ag-root-wrapper")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
  expect(summary, summary.join("\n")).toEqual([]);
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    // AG Grid prints its trial-license banner as console errors when no license key is set.
    if (m.type() === "error" && !/^\*{10,}|AG Grid|ag-grid\.com/.test(m.text().trim())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const PUBLIC_PAGES = ["/", "/lab", "/bench", "/suppliers", "/verify/rcp_does_not_exist"];
const WORKSPACE_PAGES = ["/onboarding", "/app", "/app/ledger", "/app/trust", "/app/rules", "/app/connect"];

for (const url of PUBLIC_PAGES) {
  test(`a11y + no console errors: ${url}`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await audit(page);
    expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
  });
}

for (const url of WORKSPACE_PAGES) {
  test(`a11y + no console errors: ${url} (fresh café)`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/demo");
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await audit(page);
    expect(errors).toEqual([]);
  });
}
