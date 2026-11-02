import { createHash, sign, verify } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { canonicalJson } from "@/lib/canonical-json";
import { newId } from "@/lib/ids";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { getPublicKey, getSigningKey } from "./keys";

/**
 * Signed intent receipts (inspired by AP2's mandates): one per executed payment, linking
 *   the owner's intent (their words + the compiled policy hash)
 *   → the cart the agent asked for
 *   → the guard's decision (every layer) and any human approval
 *   → the PayPal authorization, capture and payout.
 * Canonical JSON → SHA-256 → Ed25519 signature; each receipt carries the previous receipt's hash
 * for the same agent, so history can't be rewritten without breaking the chain.
 */

export type ReceiptPayload = {
  v: 1;
  type: "leash.intent_receipt";
  id: string;
  seq: number;
  issuedAt: string;
  prev: string | null;
  business: { name: string };
  agent: { id: string; name: string };
  intent: { ownerText: string; policyHash: string; mandateVersion: number; mandateCreatedAt: string };
  cart: {
    requestId: string;
    kind: "purchase" | "invoice";
    supplier: string;
    payee: string;
    items: { name: string; productId?: string; category: string; quantity: number; unitPrice: string }[];
    invoiceNumber?: string;
    amount: string;
    currency: string;
    justification: string;
    sources: string[];
  };
  decision: {
    verdict: string;
    layers: { layer: string; verdict: string; codes: string[] }[];
    autonomyLevel: number;
    approval: { decidedBy: string; decidedAt: string } | null;
  };
  paypal: {
    mode: "sandbox" | "sim";
    authorizationId: string;
    captureId: string;
    payoutBatchId: string;
  };
};

const sha256 = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;

export async function issueReceipt(
  db: DB,
  {
    receiptId,
    requestId,
    paypal,
  }: {
    receiptId: string;
    requestId: string;
    paypal: ReceiptPayload["paypal"];
  },
): Promise<{ id: string; hash: string }> {
  const [req] = await db.select().from(t.paymentRequests).where(eq(t.paymentRequests.id, requestId));
  if (!req) throw new Error(`Request ${requestId} not found`);
  const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, req.agentId));
  const [business] = await db.select().from(t.businesses).where(eq(t.businesses.id, agent.businessId));
  const [cycle] = req.cycleId ? await db.select().from(t.cycles).where(eq(t.cycles.id, req.cycleId)) : [];
  const [mandate] = cycle
    ? await db.select().from(t.mandates).where(eq(t.mandates.id, cycle.mandateId))
    : await db
        .select()
        .from(t.mandates)
        .where(and(eq(t.mandates.agentId, req.agentId), eq(t.mandates.status, "active")));
  const layers = await db.select().from(t.guardDecisions).where(eq(t.guardDecisions.requestId, requestId));
  const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.requestId, requestId));
  const key = await getSigningKey(db);

  for (let attempt = 0; attempt < 3; attempt++) {
    const [last] = await db
      .select({ seq: t.receipts.seq, hash: t.receipts.hash })
      .from(t.receipts)
      .where(eq(t.receipts.agentId, req.agentId))
      .orderBy(desc(t.receipts.seq))
      .limit(1);
    const payload: ReceiptPayload = {
      v: 1,
      type: "leash.intent_receipt",
      id: receiptId,
      seq: (last?.seq ?? 0) + 1,
      issuedAt: new Date().toISOString(),
      prev: last?.hash ?? null,
      business: { name: business.name },
      agent: { id: agent.id, name: agent.name },
      intent: {
        ownerText: mandate.ownerText,
        policyHash: mandate.policyHash,
        mandateVersion: mandate.version,
        mandateCreatedAt: mandate.createdAt.toISOString(),
      },
      cart: {
        requestId: req.id,
        kind: req.kind,
        supplier: req.supplierName,
        payee: req.payeeEmail,
        items: req.items.map((i) => ({
          name: i.name,
          productId: i.productId,
          category: i.category,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        invoiceNumber: req.invoiceNumber ?? undefined,
        amount: req.amount,
        currency: req.currency,
        justification: req.justification,
        sources: req.provenance.map((p) => p.ref),
      },
      decision: {
        verdict: req.verdict ?? "ALLOW",
        layers: layers
          .filter((l) => l.layer !== "combined")
          .sort((a, b) => a.layer.localeCompare(b.layer))
          .map((l) => ({ layer: l.layer, verdict: l.verdict, codes: l.codes })),
        autonomyLevel: agent.autonomyLevel,
        approval:
          approval?.status === "approved" && approval.decidedAt
            ? { decidedBy: approval.decidedBy ?? "owner", decidedAt: approval.decidedAt.toISOString() }
            : null,
      },
      paypal,
    };
    const canonical = canonicalJson(payload);
    const hash = sha256(canonical);
    const signature = sign(null, Buffer.from(canonical, "utf8"), key.privateKey).toString("base64url");
    try {
      await db.insert(t.receipts).values({
        id: receiptId,
        workspaceId: req.workspaceId,
        agentId: req.agentId,
        requestId,
        seq: payload.seq,
        payload,
        hash,
        prevHash: payload.prev,
        signature,
        keyId: key.kid,
      });
      return { id: receiptId, hash };
    } catch (err) {
      // Another receipt took this sequence number: retry on top of it.
      if (attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

export type VerifyCheck = { name: string; ok: boolean; detail: string };
export type Verification = { valid: boolean; checks: VerifyCheck[] };

/** Re-derives everything from the stored payload: hash, signature, and the link to the previous receipt. */
export async function verifyReceipt(
  db: DB,
  receiptId: string,
): Promise<Verification & { receipt: typeof t.receipts.$inferSelect | null }> {
  const [r] = await db.select().from(t.receipts).where(eq(t.receipts.id, receiptId));
  if (!r)
    return {
      valid: false,
      receipt: null,
      checks: [{ name: "exists", ok: false, detail: "No such receipt" }],
    };
  const checks: VerifyCheck[] = [];
  const canonical = canonicalJson(r.payload);
  const hash = sha256(canonical);
  checks.push({
    name: "hash",
    ok: hash === r.hash,
    detail: hash === r.hash ? "Content matches its fingerprint" : "Content was modified after signing",
  });

  const pub = await getPublicKey(db, r.keyId);
  let sigOk = false;
  try {
    sigOk =
      Boolean(pub) &&
      verify(null, Buffer.from(canonical, "utf8"), pub!, Buffer.from(r.signature, "base64url"));
  } catch {
    sigOk = false;
  }
  checks.push({
    name: "signature",
    ok: sigOk,
    detail: sigOk ? `Signed by Leash key ${r.keyId}` : "Signature does not match this content",
  });

  const payload = r.payload as ReceiptPayload;
  if (r.seq === 1 || payload.prev === null) {
    const ok = r.seq === 1 && payload.prev === null;
    checks.push({
      name: "chain",
      ok,
      detail: ok ? "First receipt for this agent" : "Chain start is inconsistent",
    });
  } else {
    const [prev] = await db
      .select({ hash: t.receipts.hash })
      .from(t.receipts)
      .where(and(eq(t.receipts.agentId, r.agentId), eq(t.receipts.seq, r.seq - 1)));
    const ok = Boolean(prev) && prev.hash === payload.prev;
    checks.push({
      name: "chain",
      ok,
      detail: ok ? `Links to receipt #${r.seq - 1}` : "Previous receipt is missing or was changed",
    });
  }
  return { valid: checks.every((c) => c.ok), checks, receipt: r };
}

export function newReceiptId(): string {
  return newId("rcp");
}
