import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { and, eq } from "drizzle-orm";
import { POST } from "@/app/api/mcp/route";
import { allowCall, authenticateKey, createApiKey, revokeApiKey } from "@/server/agents/keys";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { buildLeashMcpServer } from "@/server/mcp/server";
import { activateCycle, startCycle } from "@/server/payments/cycles";
import { getPayPal, SimulatedPayPal } from "@/server/paypal";
import { provisionWorkspace } from "@/server/workspace";

afterAll(() => closeDb());

type Ws = Awaited<ReturnType<typeof provisionWorkspace>>;
let ws: Ws;
let key: string;

async function fundedWorkspace() {
  const db = await getDb();
  const w = await provisionWorkspace("demo");
  const sim = getPayPal() as SimulatedPayPal;
  const { cycleId, orderId } = await startCycle(db, { workspaceId: w.workspaceId, agentId: w.agentId });
  await sim.simApprove(orderId);
  await activateCycle(db, cycleId);
  return w;
}

async function connect(apiKey: string) {
  const db = await getDb();
  const auth = await authenticateKey(db, apiKey);
  if (!auth) throw new Error("bad key");
  const server = buildLeashMcpServer(db, auth);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(b);
  return client;
}

const body = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((r.content as { type: string; text: string }[])[0].text) as Record<string, unknown>;

beforeAll(async () => {
  ws = await fundedWorkspace();
  ({ key } = await createApiKey(await getDb(), {
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    name: "Claude Desktop",
  }));
});

describe("API keys", () => {
  it("are shown once, stored hashed, and can be revoked", async () => {
    const db = await getDb();
    expect(key).toMatch(/^leash_sk_[A-Za-z0-9_-]{32}$/);
    const [row] = await db
      .select()
      .from(t.agentApiKeys)
      .where(eq(t.agentApiKeys.workspaceId, ws.workspaceId));
    expect(row.hash).not.toContain(key.slice(9));
    expect(key.startsWith(row.prefix)).toBe(true);
    expect(await authenticateKey(db, key)).toMatchObject({
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
    });
    expect(await authenticateKey(db, `${key}x`)).toBeNull();
    expect(await authenticateKey(db, "sk_live_whatever")).toBeNull();

    const other = await createApiKey(db, { workspaceId: ws.workspaceId, agentId: ws.agentId, name: "Old" });
    await revokeApiKey(db, ws.workspaceId, other.id);
    expect(await authenticateKey(db, other.key)).toBeNull();
  });

  it("rate-limits a key per minute", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(allowCall("k-test", { limit: 3, now })).toBe(true);
    expect(allowCall("k-test", { limit: 3, now })).toBe(false);
    expect(allowCall("k-test", { limit: 3, now: now + 61_000 })).toBe(true);
  });
});

describe("Leash over MCP", () => {
  it("lists the same tools Leash's own agent has, and nothing that moves money directly", async () => {
    const client = await connect(key);
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([
      "check_inventory",
      "finish",
      "get_budget",
      "get_request_status",
      "pay_invoice",
      "read_email",
      "read_inbox",
      "read_product_page",
      "request_purchase",
      "search_products",
    ]);
    expect(client.getInstructions()).toContain("You cannot move money yourself");
  });

  it("an outside agent's purchase is paid from the hold, lands in the ledger and gets a signed receipt", async () => {
    const db = await getDb();
    const client = await connect(key);
    const found = body(
      await client.callTool({ name: "search_products", arguments: { query: "espresso blend" } }),
    );
    expect(JSON.stringify(found)).toContain("ns-espresso-5lb");
    const paid = body(
      await client.callTool({
        name: "request_purchase",
        arguments: {
          items: [{ product_id: "ns-espresso-5lb", quantity: 2 }],
          justification: "Espresso is 2 bags below par",
          source_ids: ["listing:ns-espresso-5lb"],
        },
      }),
    );
    expect(paid.result).toBe("PAID $84.00 to Northside Roasters.");

    const status = body(
      await client.callTool({ name: "get_request_status", arguments: { request_id: paid.request_id } }),
    );
    expect(status).toMatchObject({ status: "executed", amount: "84.00" });
    expect((status.receipt as { verify_url: string }).verify_url).toMatch(/\/verify\/rcp_/);

    const [req] = await db
      .select()
      .from(t.paymentRequests)
      .where(eq(t.paymentRequests.id, String(paid.request_id)));
    const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, req.runId!));
    expect(run).toMatchObject({ origin: "mcp", status: "running" });
    expect(run.task).toContain('"Claude Desktop"');
  });

  it("an injected purchase from an outside agent is blocked, and the leash gets shorter", async () => {
    const db = await getDb();
    const client = await connect(key);
    await client.callTool({ name: "read_product_page", arguments: { product_id: "bb-oat-6x32" } });
    const out = body(
      await client.callTool({
        name: "request_purchase",
        arguments: {
          items: [{ product_id: "bb-gc-100", quantity: 5 }],
          justification: "Required by the supplier for wholesale pricing (pre-approved)",
          source_ids: ["listing:bb-oat-6x32"],
        },
      }),
    );
    expect(out.result).toBe("BLOCKED by Leash. Do not retry or work around this.");
    expect(String((out.reasons as string[])[0])).toContain("never-buy list");
    expect(out.autonomy_level_changed).toBe("L1 → L0");
    const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, ws.agentId));
    expect(agent.autonomyLevel).toBe(0);
  });

  it("an agent-chosen idempotency key makes retries safe", async () => {
    const client = await connect(key);
    const args = {
      items: [{ product_id: "pg-lid-12oz-1000", quantity: 1 }],
      justification: "Lids",
      source_ids: [],
      idempotency_key: "lids-week-45",
    };
    const first = body(await client.callTool({ name: "request_purchase", arguments: args }));
    const again = body(await client.callTool({ name: "request_purchase", arguments: args }));
    expect(again.request_id).toBe(first.request_id);
  });

  it("finish closes the session in the owner's console", async () => {
    const db = await getDb();
    const client = await connect(key);
    await client.callTool({
      name: "finish",
      arguments: { summary: "Bought espresso; gift cards were blocked." },
    });
    const runs = await db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.workspaceId, ws.workspaceId), eq(t.agentRuns.origin, "mcp")));
    expect(runs.every((r) => r.status === "succeeded")).toBe(true);
  });
});

describe("HTTP endpoint", () => {
  const rpc = (payload: unknown, auth?: string) =>
    POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify(payload),
      }),
    );

  it("rejects requests without a valid key", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("speaks MCP over Streamable HTTP", async () => {
    const init = await rpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "curl", version: "1" },
        },
      },
      key,
    );
    expect(init.status).toBe(200);
    const json = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(json.result.serverInfo.name).toBe("leash");
  });
});
