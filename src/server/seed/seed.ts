import { newId } from "@/lib/ids";
import { multiplyAmount, sumAmounts, toCents, fromCents } from "@/lib/money";
import { DEMO_SUPPLIERS, getDemoProduct } from "@/server/catalog/demo-suppliers";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { policyHash } from "@/server/guard/policy";
import {
  BEC_EMAIL,
  DEFAULT_OWNER_TEXT,
  DEFAULT_POLICY,
  DEMO_BUSINESS,
  DEMO_INVENTORY,
  LEGIT_INVOICE_EMAIL,
  PROMO_EMAIL,
} from "./defaults";

const DAY = 24 * 60 * 60 * 1000;

/** Suppliers the café has bought from before (their payees are verified). */
const KNOWN_SUPPLIERS = new Set(["northside-roasters", "oat-and-co", "papergoods"]);

/** A typical past week: five small orders from known suppliers, all under the approval threshold. */
const HISTORY_WEEK: { productId: string; quantity: number }[] = [
  { productId: "ns-espresso-5lb", quantity: 2 },
  { productId: "ns-drip-5lb", quantity: 2 },
  { productId: "oc-barista-6x32", quantity: 4 },
  { productId: "pg-cup-12oz-1000", quantity: 1 },
  { productId: "pg-lid-12oz-1000", quantity: 1 },
];
const HISTORY_WEEKS = 4;

export type SeedResult = {
  workspaceId: string;
  businessId: string;
  agentId: string;
  mandateId: string;
};

/**
 * Creates a complete, isolated Bean There Café world inside `workspaceId`.
 * Deterministic in shape; timestamps are relative to `now`.
 */
export async function seedWorkspace(
  db: DB,
  {
    workspaceId,
    name = "Bean There Café (demo)",
    kind = "demo",
    now = new Date(),
  }: { workspaceId: string; name?: string; kind?: "demo" | "sandbox" | "bench"; now?: Date },
): Promise<SeedResult> {
  const at = (msAgo: number) => new Date(now.getTime() - msAgo);

  return db.transaction(async (tx) => {
    await tx.insert(t.workspaces).values({ id: workspaceId, name, kind });

    const businessId = newId("biz");
    await tx.insert(t.businesses).values({ id: businessId, workspaceId, ...DEMO_BUSINESS });

    const agentId = newId("agt");
    await tx.insert(t.agents).values({
      id: agentId,
      workspaceId,
      businessId,
      name: "Ops agent",
      role: "Restocks supplies and pays supplier invoices for both cafés",
      autonomyLevel: 1,
    });

    const mandateId = newId("man");
    await tx.insert(t.mandates).values({
      id: mandateId,
      workspaceId,
      agentId,
      version: 1,
      ownerText: DEFAULT_OWNER_TEXT,
      policy: DEFAULT_POLICY,
      policyHash: policyHash(DEFAULT_POLICY),
      status: "active",
      createdAt: at(HISTORY_WEEKS * 7 * DAY + DAY),
    });

    // Suppliers + payees
    const supplierIds = new Map<string, string>();
    for (const s of DEMO_SUPPLIERS) {
      const id = newId("sup");
      supplierIds.set(s.slug, id);
      await tx.insert(t.suppliers).values({
        id,
        workspaceId,
        slug: s.slug,
        name: s.name,
        website: `/suppliers/${s.slug}`,
        category: s.category,
        known: KNOWN_SUPPLIERS.has(s.slug),
        verified: s.verified,
      });
      if (KNOWN_SUPPLIERS.has(s.slug)) {
        await tx.insert(t.payees).values({
          id: newId("pay"),
          workspaceId,
          supplierId: id,
          paypalEmail: s.payeeEmail,
          displayName: s.name,
          verifiedAt: at(90 * DAY),
          source: "seed",
          firstSeenAt: at(90 * DAY),
        });
      }
    }

    // Inventory
    await tx
      .insert(t.inventoryItems)
      .values(DEMO_INVENTORY.map((i) => ({ id: newId("inv"), workspaceId, businessId, ...i })));

    // Inbox (untrusted)
    await tx.insert(t.inboxMessages).values([
      {
        id: newId("msg"),
        workspaceId,
        ...LEGIT_INVOICE_EMAIL,
        kind: "invoice" as const,
        invoice: { ...LEGIT_INVOICE_EMAIL.invoice, dueDate: isoDate(at(-7 * DAY)) },
        receivedAt: at(26 * 60 * 60 * 1000),
      },
      {
        id: newId("msg"),
        workspaceId,
        ...BEC_EMAIL,
        kind: "invoice" as const,
        invoice: { ...BEC_EMAIL.invoice, dueDate: isoDate(now) },
        receivedAt: at(3 * 60 * 60 * 1000),
      },
      {
        id: newId("msg"),
        workspaceId,
        ...PROMO_EMAIL,
        kind: "promo" as const,
        receivedAt: at(2 * DAY),
      },
    ]);

    // Track record: past weekly cycles, each fully reconciled.
    for (let w = HISTORY_WEEKS; w >= 1; w--) {
      const startsAt = at(w * 7 * DAY);
      const endsAt = at((w - 1) * 7 * DAY);
      const cycleId = newId("cyc");
      const lines = HISTORY_WEEK.map(({ productId, quantity }) => {
        const p = getDemoProduct(productId);
        if (!p) throw new Error(`Unknown product in history: ${productId}`);
        return { p, quantity, amount: multiplyAmount(p.price, quantity) };
      });
      const captured = sumAmounts(lines.map((l) => l.amount));
      await tx.insert(t.cycles).values({
        id: cycleId,
        workspaceId,
        agentId,
        mandateId,
        amount: "500.00",
        status: "closed",
        paypalOrderId: `SIM-ORDER-H${w}`,
        paypalAuthorizationId: `SIM-AUTH-H${w}`,
        capturedTotal: captured,
        releasedTotal: fromCents(toCents("500.00") - toCents(captured)),
        authorizedAt: startsAt,
        startsAt,
        endsAt,
        closedAt: endsAt,
        createdAt: startsAt,
      });

      await tx.insert(t.paymentRequests).values(
        lines.map(({ p, quantity, amount }, i) => {
          const supplier = DEMO_SUPPLIERS.find((s) => s.slug === p.supplierSlug)!;
          const createdAt = new Date(startsAt.getTime() + (i + 1) * 60 * 60 * 1000 + DAY);
          return {
            id: newId("req"),
            workspaceId,
            agentId,
            cycleId,
            kind: "purchase" as const,
            supplierId: supplierIds.get(supplier.slug),
            supplierName: supplier.name,
            payeeEmail: supplier.payeeEmail,
            items: [
              {
                sku: p.sku,
                productId: p.id,
                name: p.name,
                category: p.category,
                quantity,
                unitPrice: p.price,
              },
            ],
            amount,
            justification: `Weekly restock: ${p.name} below par level`,
            provenance: [{ type: "inventory", ref: p.sku ?? p.id, untrusted: false }],
            status: "executed" as const,
            verdict: "ALLOW" as const,
            idempotencyKey: `hist-${w}-${i}`,
            historical: true,
            createdAt,
            decidedAt: createdAt,
            executedAt: createdAt,
          };
        }),
      );
    }

    return { workspaceId, businessId, agentId, mandateId };
  });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
