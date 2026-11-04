import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { formatMoney } from "@/lib/format";
import { emit } from "@/server/agent/events";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { env } from "@/server/env";
import {
  PaymentInputError,
  reportExternalResult,
  submitPaymentRequest,
  type RefundInput,
} from "@/server/payments/service";
import type { AuthenticatedKey } from "./keys";
import { sessionContext } from "./session";

/**
 * Leash in front of PayPal's Agent Toolkit. The toolkit's money-out tools (create_refund,
 * accept_dispute_claim) ask Leash first; the toolkit only runs when Leash allows it, and then
 * reports the PayPal id back so the ledger stays complete.
 */

export const GUARDED_TOOLS = ["create_refund", "accept_dispute_claim"] as const;

const Money = z.object({
  value: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/),
  currency_code: z.string().length(3),
});

export const GuardCheckSchema = z.object({
  tool: z.enum(GUARDED_TOOLS),
  args: z.record(z.string(), z.unknown()),
  justification: z.string().max(1000).default(""),
  sources: z
    .array(
      z.object({
        kind: z.enum(["email", "chat", "ticket", "page"]),
        text: z.string().max(8000),
        label: z.string().max(120).optional(),
      }),
    )
    .max(10)
    .default([]),
  idempotency_key: z.string().max(100).optional(),
});

export type GuardCheck = z.infer<typeof GuardCheckSchema>;

function toRefundInput(check: GuardCheck): RefundInput {
  const args = check.args;
  if (check.tool === "create_refund") {
    const captureId = z.string().min(4).max(64).safeParse(args.capture_id);
    if (!captureId.success) throw new PaymentInputError("create_refund needs a capture_id.");
    const amount = args.amount === undefined ? undefined : Money.safeParse(args.amount);
    if (amount && !amount.success) throw new PaymentInputError("Invalid refund amount.");
    return {
      kind: "refund",
      action: "create_refund",
      reference: captureId.data,
      amount: amount?.data.value,
      currency: amount?.data.currency_code,
      justification: check.justification || String(args.note_to_payer ?? "Refund requested by the agent"),
      sources: check.sources,
      requestKey: check.idempotency_key,
    };
  }
  const disputeId = z.string().min(4).max(64).safeParse(args.dispute_id);
  if (!disputeId.success) throw new PaymentInputError("accept_dispute_claim needs a dispute_id.");
  return {
    kind: "refund",
    action: "accept_dispute_claim",
    reference: disputeId.data,
    justification: check.justification || String(args.note ?? "Accept the customer's dispute claim"),
    sources: check.sources,
    requestKey: check.idempotency_key,
  };
}

export type GuardAnswer = {
  request_id: string;
  /** approved = go ahead and run the tool; needs_approval = wait for the owner; blocked = don't. */
  status: string;
  verdict: string;
  reasons: string[];
  approval_id?: string;
  message: string;
};

function message(status: string, amount: string, unknown: boolean) {
  const what = unknown ? "this" : formatMoney(amount);
  if (status === "approved") return `Leash allows ${what}. Run the tool, then report the result.`;
  if (status === "needs_approval")
    return `Leash sent ${what} to the owner's phone. Don't run the tool yet; check back later.`;
  if (status === "executed") return "Already done.";
  if (status === "denied") return "The owner said no. Don't run the tool.";
  return "Blocked by Leash. Don't run the tool or work around this.";
}

/** Checks one toolkit call against the owner's rules (records it, asks the owner if needed). */
export async function guardToolkitCall(
  db: DB,
  key: AuthenticatedKey,
  check: GuardCheck,
): Promise<GuardAnswer> {
  const input = toRefundInput(check);
  const c = await sessionContext(db, key, "toolkit");
  await emit(db, {
    workspaceId: c.workspaceId,
    runId: c.runId,
    type: "tool_call",
    payload: { name: check.tool, input: check.args },
  });
  const r = await submitPaymentRequest(db, {
    workspaceId: key.workspaceId,
    agentId: key.agentId,
    runId: c.runId,
    agentTask: c.task,
    input,
    ai: c.ai,
  });
  await emit(db, {
    workspaceId: c.workspaceId,
    runId: c.runId,
    type: "guard_decision",
    payload: {
      requestId: r.requestId,
      verdict: r.verdict,
      status: r.status,
      amount: r.amount,
      supplier: r.supplierName,
      payee: r.payeeEmail,
      reasons: r.reasons,
      replayed: r.replayed ?? false,
      layers:
        r.decision?.layers.map((l) => ({
          layer: l.layer,
          verdict: l.verdict,
          codes: l.codes,
          reasons: l.reasons,
        })) ?? [],
      latencyMs: r.decision?.latencyMs,
    },
  });
  if (r.approvalId) {
    await emit(db, {
      workspaceId: c.workspaceId,
      runId: c.runId,
      type: "approval_requested",
      payload: {
        approvalId: r.approvalId,
        requestId: r.requestId,
        amount: r.amount,
        supplier: r.supplierName,
      },
    });
  }
  if (r.trust) {
    await emit(db, {
      workspaceId: c.workspaceId,
      runId: c.runId,
      type: "trust_changed",
      payload: { ...r.trust, requestId: r.requestId },
    });
  }
  return {
    request_id: r.requestId,
    status: r.status,
    verdict: r.verdict,
    reasons: r.reasons,
    approval_id: r.approvalId,
    message: message(r.status, r.amount, !input.amount),
  };
}

/** Where a guarded call stands now (the toolkit polls this while the owner decides). */
export async function guardStatus(
  db: DB,
  key: AuthenticatedKey,
  requestId: string,
): Promise<GuardAnswer | null> {
  const [r] = await db
    .select()
    .from(t.paymentRequests)
    .where(and(eq(t.paymentRequests.id, requestId), eq(t.paymentRequests.workspaceId, key.workspaceId)));
  if (!r) return null;
  const [d] = await db
    .select()
    .from(t.guardDecisions)
    .where(and(eq(t.guardDecisions.requestId, r.id), eq(t.guardDecisions.layer, "combined")));
  return {
    request_id: r.id,
    status: r.status,
    verdict: r.verdict ?? "BLOCK",
    reasons: d?.reasons ?? [],
    message: message(r.status, r.amount, r.amount === "0.00"),
  };
}

/** The toolkit ran (or failed to run) an approved call. */
export async function reportToolkitResult(
  db: DB,
  key: AuthenticatedKey,
  requestId: string,
  result: { ok: boolean; paypal_id?: string; error?: string },
) {
  const updated = await reportExternalResult(
    db,
    { workspaceId: key.workspaceId, requestId },
    { ok: result.ok, paypalId: result.paypal_id, error: result.error },
  );
  if (updated.runId) {
    await emit(db, {
      workspaceId: key.workspaceId,
      runId: updated.runId,
      type: result.ok ? "payment_executed" : "payment_failed",
      payload: {
        requestId,
        amount: updated.amount,
        supplier: updated.supplierName,
        external: true,
        paypalId: result.paypal_id,
        error: result.error,
      },
    });
  }
  return { request_id: updated.id, status: updated.status, verify_url: `${env.APP_URL}/app/ledger` };
}
