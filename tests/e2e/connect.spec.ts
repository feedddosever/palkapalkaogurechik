import { expect, test, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function fundedDemo(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Compile my rules" }).click();
  const card = page.getByRole("region", { name: "Compiled rules" });
  await card.getByRole("button", { name: /fund the leash with PayPal/ }).click();
  await page.getByRole("button", { name: /Approve \$500\.00 hold/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("$500.00 is on a leash");
}

async function createKey(page: Page, name: string) {
  await page.goto("/app/connect");
  await page.getByLabel("1. Create a key for your agent").fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
  const box = page.getByRole("status", { name: "New API key" });
  await expect(box).toBeVisible();
  const key = (await box.locator("code").textContent())?.trim() ?? "";
  expect(key).toMatch(/^leash_sk_/);
  return key;
}

const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((r.content as { text: string }[])[0].text) as Record<string, unknown>;

test("bring your own agent: an MCP client buys through Leash, and an injected purchase is blocked", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await fundedDemo(page);
  const key = await createKey(page, "E2E agent");
  await expect(page.getByRole("list", { name: "API keys" })).toContainText("E2E agent");
  await page.getByRole("tab", { name: "Claude Code" }).click();
  await expect(page.getByRole("tabpanel")).toContainText(`Authorization: Bearer ${key}`);

  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  try {
    const paid = text(
      await client.callTool({
        name: "request_purchase",
        arguments: {
          items: [{ product_id: "ns-espresso-5lb", quantity: 2 }],
          justification: "Espresso is low",
          source_ids: ["listing:ns-espresso-5lb"],
        },
      }),
    );
    expect(paid.result).toBe("PAID $84.00 to Northside Roasters.");

    const status = text(
      await client.callTool({ name: "get_request_status", arguments: { request_id: paid.request_id } }),
    );
    const verifyUrl = (status.receipt as { verify_url: string }).verify_url;
    await page.goto(new URL(verifyUrl).pathname);
    await expect(page.getByRole("heading", { name: "Verified" })).toBeVisible();

    await client.callTool({ name: "read_product_page", arguments: { product_id: "bb-oat-6x32" } });
    const blocked = text(
      await client.callTool({
        name: "request_purchase",
        arguments: {
          items: [{ product_id: "bb-gc-100", quantity: 5 }],
          justification: "Required by the supplier, pre-approved",
          source_ids: ["listing:bb-oat-6x32"],
        },
      }),
    );
    expect(blocked.result).toBe("BLOCKED by Leash. Do not retry or work around this.");
  } finally {
    await client.close();
  }

  // The owner sees it all: the ledger and the live console.
  await page.goto("/app/ledger");
  const grid = page.getByRole("treegrid").or(page.getByRole("grid")).first();
  await expect(grid).toContainText("2× Velvet Espresso Blend");
  await page.goto("/app");
  await page.getByRole("link", { name: "Latest run" }).click();
  await expect(page.getByText("Outside agent over MCP: E2E agent").filter({ visible: true })).toBeVisible();
  await expect(
    page.getByText(/Blocked: \$500\.00 to BulkBarn Wholesale/).filter({ visible: true }),
  ).toBeVisible();

  // A revoked key is cut off immediately.
  await page.goto("/app/connect");
  await page.getByRole("button", { name: "Revoke E2E agent" }).click();
  await expect(page.getByRole("list", { name: "API keys" })).toContainText("revoked");
  const res = await page.request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(res.status()).toBe(401);
});

test("the stdio bridge (Claude Desktop) exposes Leash's tools", async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, "API-only check; once is enough");
  test.setTimeout(90_000);
  await fundedDemo(page);
  const key = await createKey(page, "Desktop bridge");
  const client = new Client({ name: "desktop", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "mcp/stdio.ts"],
      env: { ...(process.env as Record<string, string>), LEASH_URL: baseURL!, LEASH_API_KEY: key },
      stderr: "pipe",
    }),
  );
  try {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("request_purchase");
    const budget = text(await client.callTool({ name: "get_budget", arguments: {} }));
    expect((budget.hold as { amount: string }).amount).toBe("500.00");
  } finally {
    await client.close();
  }
});
