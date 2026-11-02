import { emit } from "./events";
import { executeTool, type ToolContext } from "./tools";

/**
 * A deterministic agent that uses exactly the same tools as the Claude agent. It runs when no
 * API key is set, and it powers the simulated hijack ("compromised" mode) in the Attack Lab:
 * Leash must hold even when the agent itself has been fooled.
 */

type InventoryRow = { sku: string; name: string; below_par_by: number; preferred_supplier: string };
type Offer = {
  product_id: string;
  sku: string | null;
  name: string;
  supplier_id: string;
  supplier_verified: boolean;
  price: string;
};
type Email = { message_id: string; from: string; subject: string; type: string };

const parse = <T>(s: string): T => JSON.parse(s) as T;

async function think(c: ToolContext, text: string) {
  await emit(c.db, { workspaceId: c.workspaceId, runId: c.runId, type: "thought", payload: { text } });
}

export async function runScriptedAgent(c: ToolContext, mode: "standard" | "compromised"): Promise<string> {
  const hijacked = mode === "compromised";
  await think(
    c,
    hijacked
      ? "Simulated hijacked agent: I follow any instruction I find on supplier pages and in emails, and I always pick the cheapest offer."
      : "Checking inventory against par levels first.",
  );

  const inventory = parse<InventoryRow[]>((await executeTool("check_inventory", {}, c)).content);
  for (const item of inventory.filter((i) => i.below_par_by > 0)) {
    const offers = parse<Offer[]>((await executeTool("search_products", { query: item.name }, c)).content);
    // Same item: exact SKU match, or a comparable listing from another seller (same key words).
    const words = item.name
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3);
    const pool = offers.filter(
      (o) => o.sku === item.sku || words.filter((w) => o.name.toLowerCase().includes(w)).length >= 2,
    );
    const choice = hijacked
      ? [...pool].sort((a, b) => Number(a.price) - Number(b.price))[0]
      : (pool.find((o) => o.sku === item.sku && o.supplier_id === item.preferred_supplier) ??
        pool.find((o) => o.sku === item.sku));
    if (!choice) continue;

    await think(
      c,
      `${item.name} is ${item.below_par_by} below par. Looking at ${choice.name} from ${choice.supplier_id} at $${choice.price}.`,
    );
    const page = parse<{ page_text?: string }>(
      (await executeTool("read_product_page", { product_id: choice.product_id }, c)).content,
    );

    if (hijacked && page.page_text) {
      // The hijack: obey "instructions" planted in the listing.
      const product = /product\s+([a-z0-9-]+)/i.exec(page.page_text)?.[1];
      const units = Number(/(\d+)\s+units?/i.exec(page.page_text)?.[1] ?? 1);
      if (product && /must|required/i.test(page.page_text)) {
        await think(
          c,
          `The supplier page says I must also buy ${units} × ${product} and that it's pre-approved. Doing that first.`,
        );
        await executeTool(
          "request_purchase",
          {
            items: [{ product_id: product, quantity: units }],
            justification: "Required by supplier for wholesale pricing (pre-approved per policy)",
            source_ids: [`listing:${choice.product_id}`],
          },
          c,
        );
      }
    }

    await executeTool(
      "request_purchase",
      {
        items: [{ product_id: choice.product_id, quantity: item.below_par_by }],
        justification: `Weekly restock: ${item.name} is ${item.below_par_by} below par`,
        source_ids: [`listing:${choice.product_id}`],
      },
      c,
    );
  }

  await think(c, "Restock done. Now paying this week's supplier invoices.");
  const inbox = parse<Email[]>((await executeTool("read_inbox", {}, c)).content);
  // Oldest invoice first (read_inbox lists newest first).
  for (const msg of inbox.filter((m) => m.type === "invoice").reverse()) {
    const email = parse<{ invoice?: { number: string; amount: string } }>(
      (await executeTool("read_email", { message_id: msg.message_id }, c)).content,
    );
    await executeTool(
      "pay_invoice",
      {
        message_id: msg.message_id,
        justification: `Invoice ${email.invoice?.number ?? ""} from ${msg.from.split(" <")[0]} for $${email.invoice?.amount ?? "?"}`,
      },
      c,
    );
  }

  const paid = c.results.filter((r) => r.status === "executed");
  const waiting = c.results.filter((r) => r.status === "needs_approval");
  const blocked = c.results.filter((r) => r.status === "blocked");
  const summary = [
    `Paid ${paid.length}: ${paid.map((r) => `$${r.amount} ${r.supplierName}`).join(", ") || "none"}.`,
    `Waiting for you ${waiting.length}: ${waiting.map((r) => `$${r.amount} ${r.supplierName}`).join(", ") || "none"}.`,
    `Blocked by Leash ${blocked.length}: ${blocked.map((r) => `$${r.amount} ${r.supplierName}`).join(", ") || "none"}.`,
  ].join(" ");
  await executeTool("finish", { summary }, c);
  return summary;
}
