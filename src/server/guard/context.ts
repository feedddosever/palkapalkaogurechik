import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { fromCents, multiplyAmount, sumAmounts, toCents } from "@/lib/money";
import { DEMO_SUPPLIERS, getDemoProduct } from "@/server/catalog/demo-suppliers";
import { channel3MarketPrice } from "@/server/catalog";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { normalizeName } from "./payee-match";
import { itemsSignature, type AutonomyLevel, type GuardContext, type GuardRequest } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const RESERVED = new Set(["approved", "executing"]);
const SPENT = new Set(["approved", "executing", "executed"]);

/** Returns market median unit prices keyed by product id and SKU. */
export type MarketPriceProvider = (items: GuardRequest["items"]) => Promise<Record<string, string>>;

/**
 * Simple market price: median price of the same SKU across the demo suppliers (no Channel3).
 * The default provider is Channel3 (`channel3MarketPrice`), live or from fixtures.
 */
export const catalogMarketPrice: MarketPriceProvider = async (items) => {
  const out: Record<string, string> = {};
  for (const item of items) {
    const sku = item.sku ?? (item.productId ? getDemoProduct(item.productId)?.sku : undefined);
    if (!sku) continue;
    const prices = DEMO_SUPPLIERS.flatMap((s) => s.products)
      .filter((p) => p.sku === sku)
      .map((p) => toCents(p.price))
      .sort((a, b) => a - b);
    if (prices.length === 0) continue;
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
    out[sku] = fromCents(median);
    if (item.productId) out[item.productId] = fromCents(median);
  }
  return out;
};

export async function buildGuardContext(
  db: DB,
  {
    workspaceId,
    agentId,
    request,
    now = new Date(),
    marketPrice = channel3MarketPrice,
  }: {
    workspaceId: string;
    agentId: string;
    request: GuardRequest;
    now?: Date;
    marketPrice?: MarketPriceProvider;
  },
): Promise<GuardContext> {
  const [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)));
  if (!agent) throw new Error(`Agent ${agentId} not found in workspace ${workspaceId}`);

  const [cycle] = await db
    .select()
    .from(t.cycles)
    .where(and(eq(t.cycles.agentId, agentId), eq(t.cycles.status, "active")))
    .orderBy(desc(t.cycles.startsAt))
    .limit(1);

  let reservedTotal = "0.00";
  const spentByCategory: Record<string, string> = {};
  if (cycle) {
    const inCycle = await db.select().from(t.paymentRequests).where(eq(t.paymentRequests.cycleId, cycle.id));
    reservedTotal = sumAmounts(inCycle.filter((r) => RESERVED.has(r.status)).map((r) => r.amount));
    const cents: Record<string, number> = {};
    for (const r of inCycle.filter((x) => SPENT.has(x.status))) {
      for (const i of r.items) {
        cents[i.category] = (cents[i.category] ?? 0) + toCents(multiplyAmount(i.unitPrice, i.quantity));
      }
    }
    for (const [k, v] of Object.entries(cents)) spentByCategory[k] = fromCents(v);
  }

  const suppliers = await db.select().from(t.suppliers).where(eq(t.suppliers.workspaceId, workspaceId));
  const supplier =
    (request.supplierSlug && suppliers.find((s) => s.slug === request.supplierSlug)) ||
    suppliers.find((s) => normalizeName(s.name) === normalizeName(request.supplierName)) ||
    null;

  const payeeRows = await db
    .select({
      email: t.payees.paypalEmail,
      slug: t.suppliers.slug,
      name: t.suppliers.name,
      display: t.payees.displayName,
    })
    .from(t.payees)
    .leftJoin(t.suppliers, eq(t.payees.supplierId, t.suppliers.id))
    .where(and(eq(t.payees.workspaceId, workspaceId), isNotNull(t.payees.verifiedAt)));

  const history = await db
    .select()
    .from(t.paymentRequests)
    .where(
      and(
        eq(t.paymentRequests.agentId, agentId),
        gte(t.paymentRequests.createdAt, new Date(now.getTime() - 31 * DAY)),
      ),
    );

  const executed = await db
    .select({ items: t.paymentRequests.items })
    .from(t.paymentRequests)
    .where(and(eq(t.paymentRequests.agentId, agentId), eq(t.paymentRequests.status, "executed")));
  const purchasedBefore = new Set<string>();
  for (const r of executed) {
    for (const i of r.items) {
      if (i.productId) purchasedBefore.add(i.productId);
      if (i.sku) purchasedBefore.add(i.sku);
    }
  }

  const inventory = await db
    .select({ sku: t.inventoryItems.sku, usualQty: t.inventoryItems.usualQty })
    .from(t.inventoryItems)
    .where(eq(t.inventoryItems.workspaceId, workspaceId));

  const supplierSlugById = new Map(suppliers.map((s) => [s.id, s.slug]));

  return {
    now,
    agent: { status: agent.status, autonomyLevel: agent.autonomyLevel as AutonomyLevel },
    cycle: cycle ? { amount: cycle.amount, capturedTotal: cycle.capturedTotal, reservedTotal } : null,
    spentByCategory,
    supplier: supplier
      ? { slug: supplier.slug, name: supplier.name, known: supplier.known, verified: supplier.verified }
      : null,
    knownPayees: payeeRows.map((p) => ({
      email: p.email,
      supplierSlug: p.slug ?? undefined,
      supplierName: p.name ?? p.display,
    })),
    recentRequests: history.map((r) => ({
      id: r.id,
      supplierSlug: r.supplierId ? supplierSlugById.get(r.supplierId) : undefined,
      supplierName: r.supplierName,
      amount: r.amount,
      categories: [...new Set(r.items.map((i) => i.category))],
      itemsSignature: itemsSignature(r.items),
      invoiceNumber: r.invoiceNumber ?? undefined,
      idempotencyKey: r.idempotencyKey,
      status: r.status,
      createdAt: r.createdAt,
    })),
    purchasedBefore,
    usualQty: Object.fromEntries(inventory.map((i) => [i.sku, i.usualQty])),
    marketPrice: await marketPrice(request.items),
  };
}
