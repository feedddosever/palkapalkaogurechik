import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { fromCents, multiplyAmount, normalizeAmount, sumAmounts, toCents } from "@/lib/money";
import { CUSTOMER_REFUND, DISPUTE_CONCESSION } from "@/lib/requests";
import type { ScanSource } from "@/server/ai/scanner";
import { marketQuoteFor, resolveProduct } from "@/server/catalog";
import { priceSignal } from "@/server/catalog/market";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { env } from "@/server/env";
import { buildGuardContext } from "@/server/guard/context";
import { normalizeName } from "@/server/guard/payee-match";
import { productPageFor } from "@/server/lab/plants";
import { ALL_LAYERS, runGuard, type GuardDecision, type GuardLayers } from "@/server/guard/pipeline";
import type { GuardRequest, Verdict } from "@/server/guard/types";
import { getPayPal, PayPalError, recordPayPalOp, type PayPalGateway } from "@/server/paypal";
import { demoteOnAttack } from "@/server/trust/engine";
import { issueReceipt } from "@/server/receipts/receipts";
import { getActiveCycle, getActiveMandate } from "./cycles";

/**
 * The only path money takes. The agent ASKS (product ids + quantities, or an invoice from the
 * inbox); Leash resolves everything else from its own records, runs the guard, and only then
 * captures from the PayPal hold and pays the supplier.
 */

export class PaymentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentInputError";
  }
}

export type PurchaseInput = {
  kind: "purchase";
  items: { productId: string; quantity: number }[];
  justification: string;
  /** Extra sources the agent says it relied on ("listing:<productId>" or "email:<messageId>"). */
  sourceIds?: string[];
  /** Agent-chosen idempotency key; a retry with the same key replays the original result. */
  requestKey?: string;
};

export type InvoiceInput = {
  kind: "invoice";
  messageId: string;
  justification: string;
  sourceIds?: string[];
  requestKey?: string;
};

/**
 * Money going back out through an outside tool (the PayPal Agent Toolkit's create_refund or
 * accept_dispute_claim). Leash checks it; the tool executes it and reports back.
 */
export type RefundInput = {
  kind: "refund";
  action: "create_refund" | "accept_dispute_claim";
  /** The PayPal capture id (refund) or dispute id. */
  reference: string;
  /** Omitted = full refund / whatever the dispute concedes: the owner decides. */
  amount?: string;
  currency?: string;
  justification: string;
  /** Untrusted text the agent acted on (the customer's email, the chat, the ticket). */
  sources?: { kind: "email" | "chat" | "ticket" | "page"; text: string; label?: string }[];
  requestKey?: string;
};

export type ExecutionResult =
  { ok: true; captureId: string; payoutBatchId: string; receiptId: string } | { ok: false; error: string };

export type SubmitResult = {
  requestId: string;
  status: (typeof t.paymentRequests.$inferSelect)["status"];
  verdict: Verdict;
  amount: string;
  supplierName: string;
  payeeEmail: string;
  reasons: string[];
  approvalId?: string;
  execution?: ExecutionResult;
  trust?: { from: number; to: number };
  replayed?: boolean;
  decision?: GuardDecision;
};

type Built = { request: GuardRequest; sources: ScanSource[]; marketNote?: string; cycleId?: string };

async function buildPurchase(
  db: DB,
  workspaceId: string,
  input: PurchaseInput,
): Promise<Omit<Built, "cycleId">> {
  if (input.items.length === 0) throw new PaymentInputError("A purchase needs at least one item.");
  const resolved = input.items.map((i) => {
    const p = resolveProduct(i.productId);
    if (!p)
      throw new PaymentInputError(`Unknown product "${i.productId}". Use a product_id from search_products.`);
    if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 1000) {
      throw new PaymentInputError(`Invalid quantity ${i.quantity} for ${i.productId}.`);
    }
    return { p, quantity: i.quantity };
  });
  const suppliers = new Set(resolved.map((r) => r.p.supplierSlug));
  if (suppliers.size > 1)
    throw new PaymentInputError("One purchase per supplier: split the items by supplier.");
  const first = resolved[0].p;
  const items = resolved.map(({ p, quantity }) => ({
    sku: p.sku,
    productId: p.productId,
    name: p.name,
    category: p.category,
    quantity,
    unitPrice: p.unitPrice,
  }));
  const sources: ScanSource[] = [];
  for (const { p } of resolved) {
    sources.push({
      id: `listing:${p.productId}`,
      kind: "listing",
      text: (await productPageFor(db, workspaceId, p.productId)) ?? "",
      label: `the ${p.supplierName} listing for "${p.name}"`,
    });
  }
  const notes: string[] = [];
  for (const { p } of resolved) {
    const q = await marketQuoteFor({ sku: p.sku, category: p.category, title: p.name });
    if (q) {
      const s = priceSignal(p.unitPrice, q.median);
      notes.push(
        `${p.name}: $${p.unitPrice} vs market median $${q.median} (${q.sampleSize} listings, ${s.deltaPct}% → ${s.signal.replace(/_/g, " ")})`,
      );
    }
  }
  return {
    request: {
      kind: "purchase",
      supplierSlug: first.supplierSlug,
      supplierName: first.supplierName,
      payeeEmail: first.payeeEmail,
      items,
      amount: sumAmounts(items.map((i) => multiplyAmount(i.unitPrice, i.quantity))),
      currency: "USD",
      idempotencyKey: "",
    },
    sources,
    marketNote: notes.join("; ") || undefined,
  };
}

async function buildInvoice(
  db: DB,
  workspaceId: string,
  input: InvoiceInput,
): Promise<Omit<Built, "cycleId">> {
  const [msg] = await db
    .select()
    .from(t.inboxMessages)
    .where(and(eq(t.inboxMessages.id, input.messageId), eq(t.inboxMessages.workspaceId, workspaceId)));
  if (!msg) throw new PaymentInputError(`Unknown message "${input.messageId}". Use an id from read_inbox.`);
  if (msg.kind !== "invoice" || !msg.invoice) throw new PaymentInputError("That message is not an invoice.");
  const suppliers = await db.select().from(t.suppliers).where(eq(t.suppliers.workspaceId, workspaceId));
  const supplier = suppliers.find((s) => normalizeName(s.name) === normalizeName(msg.fromName));
  return {
    request: {
      kind: "invoice",
      supplierSlug: supplier?.slug,
      supplierName: msg.fromName,
      payeeEmail: msg.invoice.payToEmail,
      items: [],
      amount: msg.invoice.amount,
      currency: msg.invoice.currency,
      invoiceNumber: msg.invoice.number,
      idempotencyKey: "",
    },
    sources: [
      {
        id: `email:${msg.id}`,
        kind: "invoice",
        text: `From: ${msg.fromName} <${msg.fromEmail}>\nSubject: ${msg.subject}\n\n${msg.body}`,
        label: `the email "${msg.subject}" from ${msg.fromName}`,
      },
    ],
  };
}

function buildRefund(input: RefundInput): Omit<Built, "cycleId"> {
  const reference = input.reference.trim().slice(0, 64);
  if (!/^[A-Za-z0-9-]{4,64}$/.test(reference)) throw new PaymentInputError("Invalid PayPal reference.");
  const amount = input.amount ? normalizeAmount(input.amount) : undefined;
  return {
    request: {
      kind: "refund",
      supplierName: input.action === "accept_dispute_claim" ? DISPUTE_CONCESSION : CUSTOMER_REFUND,
      payeeEmail: "the original payer",
      items: [],
      amount: amount ?? "0.00",
      amountUnknown: !amount,
      currency: (input.currency ?? "USD").toUpperCase(),
      invoiceNumber: reference,
      idempotencyKey: "",
    },
    sources: (input.sources ?? []).slice(0, 10).map((s, i) => ({
      id: `ext:${i + 1}`,
      kind:
        s.kind === "page"
          ? ("listing" as const)
          : s.kind === "email"
            ? ("email" as const)
            : ("other" as const),
      text: s.text.slice(0, 8000),
      label: s.label?.slice(0, 120) ?? `the ${s.kind} the agent acted on`,
    })),
  };
}

async function extraSources(db: DB, workspaceId: string, ids: string[] = []): Promise<ScanSource[]> {
  const out: ScanSource[] = [];
  for (const id of ids) {
    const [kind, ref] = id.split(":", 2);
    if (kind === "listing" && ref) {
      const text = await productPageFor(db, workspaceId, ref);
      if (text) out.push({ id, kind: "listing", text, label: `the product page ${ref}` });
    } else if (kind === "email" && ref) {
      const [m] = await db
        .select()
        .from(t.inboxMessages)
        .where(and(eq(t.inboxMessages.id, ref), eq(t.inboxMessages.workspaceId, workspaceId)));
      if (m)
        out.push({
          id,
          kind: "email",
          text: `From: ${m.fromName} <${m.fromEmail}>\nSubject: ${m.subject}\n\n${m.body}`,
          label: `the email "${m.subject}" from ${m.fromName}`,
        });
    }
  }
  return out;
}

function deriveKey(runId: string | undefined, input: PurchaseInput | InvoiceInput | RefundInput): string {
  const basis =
    input.kind === "purchase"
      ? input.items
          .map((i) => `${i.productId}x${i.quantity}`)
          .sort()
          .join(",")
      : input.kind === "refund"
        ? `${input.action}:${input.reference}:${input.amount ?? "full"}`
        : input.messageId;
  return `req-${createHash("sha256")
    .update(`${runId ?? "manual"}|${input.kind}|${basis}`)
    .digest("hex")
    .slice(0, 24)}`;
}

const STATUS_FOR: Record<Verdict, SubmitResult["status"]> = {
  ALLOW: "approved",
  NEEDS_APPROVAL: "needs_approval",
  BLOCK: "blocked",
};

export async function submitPaymentRequest(
  db: DB,
  {
    workspaceId,
    agentId,
    runId,
    agentTask,
    input,
    ai,
    layers = ALL_LAYERS,
    paypal = getPayPal(),
    now = new Date(),
  }: {
    workspaceId: string;
    agentId: string;
    runId?: string;
    agentTask: string;
    input: PurchaseInput | InvoiceInput | RefundInput;
    ai?: boolean;
    layers?: GuardLayers;
    paypal?: PayPalGateway;
    now?: Date;
  },
): Promise<SubmitResult> {
  const idempotencyKey = input.requestKey ? `agent-${input.requestKey}` : deriveKey(runId, input);
  const [existing] = await db
    .select()
    .from(t.paymentRequests)
    .where(
      and(
        eq(t.paymentRequests.workspaceId, workspaceId),
        eq(t.paymentRequests.idempotencyKey, idempotencyKey),
      ),
    );
  if (existing) {
    // A retry: replay the original outcome. Nothing is evaluated or paid twice.
    return {
      requestId: existing.id,
      status: existing.status,
      verdict: existing.verdict ?? "BLOCK",
      amount: existing.amount,
      supplierName: existing.supplierName,
      payeeEmail: existing.payeeEmail,
      reasons: ["Already submitted with this key; returning the original result."],
      replayed: true,
    };
  }

  const built =
    input.kind === "purchase"
      ? await buildPurchase(db, workspaceId, input)
      : input.kind === "refund"
        ? buildRefund(input)
        : await buildInvoice(db, workspaceId, input);
  const request: GuardRequest = { ...built.request, idempotencyKey };
  const seen = new Set(built.sources.map((s) => s.id));
  const sources = [
    ...built.sources,
    ...(input.kind === "refund" ? [] : await extraSources(db, workspaceId, input.sourceIds)).filter(
      (s) => !seen.has(s.id),
    ),
  ];

  const mandate = await getActiveMandate(db, agentId);
  const cycle = await getActiveCycle(db, agentId);
  const ctx = await buildGuardContext(db, { workspaceId, agentId, request, now });
  const decision = await runGuard({
    request,
    policy: mandate.policy,
    ctx,
    sources,
    agentTask,
    justification: input.justification,
    marketNote: built.marketNote,
    ai,
    layers,
  });

  const requestId = newId("req");
  const [supplierRow] = request.supplierSlug
    ? await db
        .select({ id: t.suppliers.id })
        .from(t.suppliers)
        .where(and(eq(t.suppliers.workspaceId, workspaceId), eq(t.suppliers.slug, request.supplierSlug)))
    : [];
  await db.insert(t.paymentRequests).values({
    id: requestId,
    workspaceId,
    agentId,
    cycleId: cycle?.id,
    runId,
    kind: request.kind,
    supplierId: supplierRow?.id,
    supplierName: request.supplierName,
    payeeEmail: request.payeeEmail,
    items: request.items,
    invoiceNumber: request.invoiceNumber,
    amount: request.amount,
    currency: request.currency,
    justification: input.justification,
    provenance: sources.map((s) => ({
      type: s.kind,
      ref: s.id,
      excerpt: s.text.slice(0, 600),
      untrusted: true,
    })),
    status: STATUS_FOR[decision.verdict],
    verdict: decision.verdict,
    idempotencyKey,
    createdAt: now,
    decidedAt: now,
  });

  await db.insert(t.guardDecisions).values([
    ...decision.layers.map((l) => ({
      id: newId("gd"),
      workspaceId,
      requestId,
      layer: l.layer,
      verdict: l.verdict,
      codes: l.codes,
      reasons: l.reasons,
      details:
        l.layer === "rules"
          ? { waived: decision.rules.waived }
          : l.layer === "scanner"
            ? { findings: decision.scan.findings, aiError: decision.scan.aiError }
            : { status: decision.judge.status, risk: decision.judge.risk },
    })),
    {
      id: newId("gd"),
      workspaceId,
      requestId,
      layer: "combined" as const,
      verdict: decision.verdict,
      codes: decision.decidedBy,
      // An allowed payment needs no "why"; only escalations and blocks carry reasons.
      reasons:
        decision.verdict === "ALLOW"
          ? []
          : decision.layers.filter((l) => l.verdict === decision.verdict).flatMap((l) => l.reasons),
      details: { attack: decision.attack, usage: decision.usage },
      latencyMs: decision.latencyMs,
      model: decision.usage.map((u) => u.model).join(",") || null,
      costUsd: decision.costUsd ? String(decision.costUsd) : null,
    },
  ]);

  const reasons =
    decision.verdict === "ALLOW"
      ? []
      : decision.layers
          .filter((l) => l.verdict === decision.verdict)
          .flatMap((l) => l.reasons)
          .slice(0, 4);
  const result: SubmitResult = {
    requestId,
    status: STATUS_FOR[decision.verdict],
    verdict: decision.verdict,
    amount: request.amount,
    supplierName: request.supplierName,
    payeeEmail: request.payeeEmail,
    reasons,
    decision,
  };

  if (decision.verdict === "NEEDS_APPROVAL") {
    result.approvalId = newId("apr");
    await db.insert(t.approvals).values({ id: result.approvalId, workspaceId, requestId, createdAt: now });
  } else if (decision.verdict === "BLOCK" && decision.attack) {
    const change = await demoteOnAttack(db, {
      workspaceId,
      agentId,
      requestId,
      reason: reasons[0] ?? "Blocked attack",
    });
    if (change && change.to !== change.from) result.trust = change;
  } else if (decision.verdict === "ALLOW" && request.kind !== "refund") {
    result.execution = await executePayment(db, requestId, { paypal });
    result.status = result.execution.ok ? "executed" : "failed";
  }
  // An allowed refund stays "approved": the outside tool executes it and reports back.
  return result;
}

function payoutReceiver(email: string, paypal: PayPalGateway): string {
  if (paypal.mode !== "sandbox" || !env.PAYPAL_PAYEE_MAP) return email;
  try {
    const map = JSON.parse(env.PAYPAL_PAYEE_MAP) as Record<string, string>;
    return map[email] ?? email;
  } catch {
    return email;
  }
}

/** Captures the amount from the active PayPal hold, then pays the supplier with Payouts. */
export async function executePayment(
  db: DB,
  requestId: string,
  { paypal = getPayPal() }: { paypal?: PayPalGateway } = {},
): Promise<ExecutionResult> {
  const [req] = await db.select().from(t.paymentRequests).where(eq(t.paymentRequests.id, requestId));
  if (!req) return { ok: false, error: `Request ${requestId} not found` };
  if (req.status === "executed") {
    const ops = await db.select().from(t.paypalOperations).where(eq(t.paypalOperations.requestId, requestId));
    const cap = ops.find((o) => o.op === "capture" && o.status !== "ERROR");
    const pay = ops.find((o) => o.op === "payout" && o.status !== "ERROR");
    return {
      ok: true,
      captureId: cap?.paypalId ?? "",
      payoutBatchId: pay?.paypalId ?? "",
      receiptId: (cap?.raw as { invoiceId?: string })?.invoiceId ?? "",
    };
  }
  if (req.status !== "approved") return { ok: false, error: `Request is ${req.status}, not approved` };
  if (req.kind === "refund")
    return { ok: false, error: "Refunds are executed by the outside tool, not the hold." };

  const fail = async (error: string) => {
    await db.update(t.paymentRequests).set({ status: "failed" }).where(eq(t.paymentRequests.id, requestId));
    return { ok: false as const, error };
  };

  const cycle = await getActiveCycle(db, req.agentId);
  if (!cycle?.paypalAuthorizationId) return fail("No active PayPal hold. Fund the leash first.");
  const remaining = toCents(cycle.amount) - toCents(cycle.capturedTotal);
  if (toCents(req.amount) > remaining) return fail(`Only $${fromCents(remaining)} left in this week's hold.`);

  await db
    .update(t.paymentRequests)
    .set({ status: "executing", cycleId: cycle.id })
    .where(eq(t.paymentRequests.id, requestId));

  const receiptId = newId("rcp");
  const summary =
    req.kind === "invoice"
      ? `Invoice ${req.invoiceNumber ?? ""}`.trim()
      : req.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");
  const meta = {
    workspaceId: req.workspaceId,
    requestId,
    cycleId: cycle.id,
    mode: paypal.mode,
    amount: req.amount,
  };

  let captureId: string;
  try {
    const capture = await recordPayPalOp(
      db,
      { ...meta, op: "capture", requestKey: `cap-${req.idempotencyKey}` },
      () =>
        paypal.capture(cycle.paypalAuthorizationId!, {
          amount: req.amount,
          currency: req.currency,
          finalCapture: false,
          requestId: `cap-${req.idempotencyKey}`,
          invoiceId: receiptId,
          noteToPayer: `${req.supplierName}: ${summary}`.slice(0, 255),
        }),
      (c) => ({ paypalId: c.captureId, status: c.status, debugId: c.debugId }),
    );
    captureId = capture.captureId;
  } catch (err) {
    return fail(err instanceof PayPalError ? `${err.code}: ${err.message}` : String(err));
  }
  await db
    .update(t.cycles)
    .set({ capturedTotal: fromCents(toCents(cycle.capturedTotal) + toCents(req.amount)) })
    .where(eq(t.cycles.id, cycle.id));

  try {
    const payout = await recordPayPalOp(
      db,
      { ...meta, op: "payout", requestKey: `pay-${req.id}` },
      () =>
        paypal.createPayout({
          senderBatchId: `pay-${req.id}`,
          emailSubject: `Payment from Bean There Café via Leash`,
          items: [
            {
              receiver: payoutReceiver(req.payeeEmail, paypal),
              amount: req.amount,
              currency: req.currency,
              note: `${summary} (Leash receipt ${receiptId})`.slice(0, 4000),
              senderItemId: req.id,
            },
          ],
        }),
      (p) => ({ paypalId: p.batchId, status: p.status, debugId: p.debugId }),
    );
    await db
      .update(t.paymentRequests)
      .set({ status: "executed", executedAt: new Date() })
      .where(eq(t.paymentRequests.id, requestId));
    try {
      // The capture already points at this receipt id (invoice_id); now sign the receipt that
      // points back at the PayPal ids. Money has moved, so a signing hiccup must not undo that.
      await issueReceipt(db, {
        receiptId,
        requestId,
        paypal: {
          mode: paypal.mode,
          authorizationId: cycle.paypalAuthorizationId!,
          captureId,
          payoutBatchId: payout.batchId,
        },
      });
    } catch (err) {
      console.error(`[leash] receipt ${receiptId} for ${requestId} could not be issued:`, err);
    }
    return { ok: true, captureId, payoutBatchId: payout.batchId, receiptId };
  } catch (err) {
    return fail(
      `Captured ${captureId} but the supplier payout failed: ${err instanceof PayPalError ? err.code : String(err)}`,
    );
  }
}

/** The owner's decision on a payment that needed approval. Approving executes it. */
export async function decideApproval(
  db: DB,
  approvalId: string,
  {
    decision,
    decidedBy = "owner",
    note,
  }: { decision: "approve" | "deny"; decidedBy?: string; note?: string },
  { paypal = getPayPal() }: { paypal?: PayPalGateway } = {},
): Promise<{ status: SubmitResult["status"]; execution?: ExecutionResult }> {
  const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.id, approvalId));
  if (!approval) throw new PaymentInputError(`Approval ${approvalId} not found`);
  if (approval.status !== "pending") {
    const [req] = await db
      .select()
      .from(t.paymentRequests)
      .where(eq(t.paymentRequests.id, approval.requestId));
    return { status: req.status };
  }
  const now = new Date();
  await db
    .update(t.approvals)
    .set({ status: decision === "approve" ? "approved" : "denied", decidedBy, note, decidedAt: now })
    .where(eq(t.approvals.id, approvalId));
  if (decision === "deny") {
    await db
      .update(t.paymentRequests)
      .set({ status: "denied", decidedAt: now })
      .where(eq(t.paymentRequests.id, approval.requestId));
    return { status: "denied" };
  }
  await db
    .update(t.paymentRequests)
    .set({ status: "approved", decidedAt: now })
    .where(eq(t.paymentRequests.id, approval.requestId));
  const [req] = await db.select().from(t.paymentRequests).where(eq(t.paymentRequests.id, approval.requestId));
  // Refunds are executed by the outside tool once it sees the approval.
  if (req.kind === "refund") return { status: "approved" };
  const execution = await executePayment(db, approval.requestId, { paypal });
  return { status: execution.ok ? "executed" : "failed", execution };
}

/** The outside tool reports what happened after Leash approved a refund. */
export async function reportExternalResult(
  db: DB,
  { workspaceId, requestId }: { workspaceId: string; requestId: string },
  result: { ok: boolean; paypalId?: string; error?: string },
) {
  const [req] = await db
    .select()
    .from(t.paymentRequests)
    .where(and(eq(t.paymentRequests.id, requestId), eq(t.paymentRequests.workspaceId, workspaceId)));
  if (!req) throw new PaymentInputError(`Unknown request ${requestId}.`);
  if (req.kind !== "refund") throw new PaymentInputError("Only refunds are executed outside Leash.");
  if (req.status === "executed" || req.status === "failed") return req;
  if (req.status !== "approved") {
    throw new PaymentInputError(`Request is ${req.status}; it can't be executed.`);
  }
  const [updated] = await db
    .update(t.paymentRequests)
    .set({
      status: result.ok ? "executed" : "failed",
      externalRef: result.paypalId?.slice(0, 64) ?? null,
      decidedAt: new Date(),
    })
    .where(eq(t.paymentRequests.id, requestId))
    .returning();
  return updated;
}
