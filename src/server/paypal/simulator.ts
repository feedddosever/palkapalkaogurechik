import { and, eq, gte, lte } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { fromCents, normalizeAmount, toCents } from "@/lib/money";
import type { DB } from "@/server/db/client";
import { paypalSimIdempotency, paypalSimObjects } from "@/server/db/schema";
import {
  AUTHORIZATION_VALID_DAYS,
  HONOR_PERIOD_DAYS,
  duplicatePayout,
  PayPalError,
  type AuthorizationInfo,
  type AuthorizationStatus,
  type CaptureInfo,
  type CaptureInput,
  type CreateHoldOrderInput,
  type HoldOrder,
  type OrderStatus,
  type PayoutInfo,
  type PayoutInput,
  type PayPalGateway,
  type RefundInfo,
  type TransactionSummary,
} from "./types";

/**
 * A local PayPal that follows the same rules as the real one, so Leash can be developed, tested
 * and benchmarked offline. Rules mirrored from PayPal Orders v2 / Payments v2 / Payouts v1:
 *  - an order must be APPROVED by the payer before it can be authorized (ORDER_NOT_APPROVED)
 *  - authorizations: 3-day honor period, valid for 29 days (AUTHORIZATION_EXPIRED)
 *  - several partial captures with final_capture=false; total ≤ min(115%, +$75) of the hold
 *  - a partially captured authorization can be voided (releases the rest)
 *  - invoice_id must be unique per capture (DUPLICATE_TRANSACTION, as the sandbox returns)
 *  - a repeated payout sender_batch_id is rejected (DUPLICATE_PAYOUT), not replayed
 *  - one reauthorization, only after the honor period
 *  - PayPal-Request-Id replays the original response instead of repeating the operation
 *
 * The simulator never pretends to be PayPal in the UI: anything it creates is prefixed `SIM-`.
 */

const DAY = 24 * 60 * 60 * 1000;
const MAX_CAPTURES = 10;
const id = customAlphabet("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 14);

type SimOrder = {
  id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  description: string;
  customId: string;
  invoiceId?: string;
  vault: boolean;
  returnUrl: string;
  cancelUrl: string;
  payer?: { email: string; payerId: string };
  authorizationId?: string;
  createdAt: string;
};

type SimAuthorization = {
  id: string;
  orderId: string;
  status: AuthorizationStatus;
  amount: string;
  currency: string;
  capturedCents: number;
  captureIds: string[];
  createdAt: string;
  honorUntil: string;
  expiresAt: string;
  vaultId?: string;
  payer?: { email: string; payerId: string };
  reauthorizedFrom?: string;
  reauthorizedTo?: string;
};

type SimCapture = CaptureInfo & { createdAt: string; refundedCents: number; noteToPayer?: string };
type SimRefund = RefundInfo & { captureId: string; createdAt: string };
type SimPayout = PayoutInfo & { createdAt: string };
type SimVaultToken = { id: string; payer: { email: string; payerId: string }; createdAt: string };

type Kind = "order" | "authorization" | "capture" | "payout" | "refund" | "vault_token";

export class SimulatedPayPal implements PayPalGateway {
  readonly mode = "sim" as const;

  constructor(
    private readonly db: () => Promise<DB>,
    private readonly opts: { appUrl: string; clock?: () => Date },
  ) {}

  private now(): Date {
    return this.opts.clock?.() ?? new Date();
  }

  // ─── storage ──────────────────────────────────────────────────────────────

  private async load<T>(objectId: string, kind: Kind): Promise<T> {
    const db = await this.db();
    const [row] = await db.select().from(paypalSimObjects).where(eq(paypalSimObjects.id, objectId));
    if (!row || row.kind !== kind) {
      throw new PayPalError("RESOURCE_NOT_FOUND", `The specified ${kind} does not exist: ${objectId}`, 404);
    }
    return row.data as T;
  }

  private async save(objectId: string, kind: Kind, data: unknown): Promise<void> {
    const db = await this.db();
    const updatedAt = this.now();
    await db
      .insert(paypalSimObjects)
      .values({ id: objectId, kind, data, createdAt: updatedAt, updatedAt })
      .onConflictDoUpdate({ target: paypalSimObjects.id, set: { data, updatedAt } });
  }

  /** PayPal-Request-Id semantics: the same key replays the first response. */
  private async idempotent<T>(op: string, requestId: string, run: () => Promise<T>): Promise<T> {
    const db = await this.db();
    const key = `${op}:${requestId}`;
    const [hit] = await db.select().from(paypalSimIdempotency).where(eq(paypalSimIdempotency.key, key));
    if (hit) return hit.response as T;
    const response = await run();
    await db.insert(paypalSimIdempotency).values({ key, response }).onConflictDoNothing();
    return response;
  }

  // ─── simulator-only controls (used by the offline approval page and tests) ─

  /** The payer approves the order on the simulated PayPal checkout page. */
  async simApprove(orderId: string, payer = { email: "dana@beanthere.example", payerId: "SIMPAYER0001" }) {
    const order = await this.load<SimOrder>(orderId, "order");
    if (order.status === "COMPLETED") return this.toHoldOrder(order);
    if (order.status === "VOIDED") throw new PayPalError("ORDER_VOIDED", "The order was voided.", 422);
    const approved: SimOrder = { ...order, status: "APPROVED", payer };
    await this.save(orderId, "order", approved);
    return this.toHoldOrder(approved);
  }

  /** Amount and description of a simulated order (for the simulator's checkout page). */
  async orderDetails(orderId: string): Promise<{ amount: string; description: string; vault: boolean }> {
    const o = await this.load<SimOrder>(orderId, "order");
    return { amount: o.amount, description: o.description, vault: o.vault };
  }

  async simCancel(orderId: string) {
    const order = await this.load<SimOrder>(orderId, "order");
    if (order.status === "COMPLETED") return this.toHoldOrder(order);
    const voided: SimOrder = { ...order, status: "VOIDED" };
    await this.save(orderId, "order", voided);
    return this.toHoldOrder(voided);
  }

  // ─── orders ───────────────────────────────────────────────────────────────

  createHoldOrder(input: CreateHoldOrderInput): Promise<HoldOrder> {
    return this.idempotent("create_order", input.requestId, async () => {
      assertPositive(input.amount);
      const order: SimOrder = {
        id: `SIM-O-${id()}`,
        status: "PAYER_ACTION_REQUIRED",
        amount: normalizeAmount(input.amount),
        currency: input.currency,
        description: input.description,
        customId: input.customId,
        invoiceId: input.invoiceId,
        vault: Boolean(input.vault),
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        createdAt: this.now().toISOString(),
      };
      await this.save(order.id, "order", order);
      return this.toHoldOrder(order);
    });
  }

  async getOrder(orderId: string): Promise<HoldOrder> {
    return this.toHoldOrder(await this.load<SimOrder>(orderId, "order"));
  }

  authorizeOrder(orderId: string, { requestId }: { requestId: string }): Promise<AuthorizationInfo> {
    return this.idempotent("authorize_order", requestId, async () => {
      const order = await this.load<SimOrder>(orderId, "order");
      if (order.status === "COMPLETED") {
        throw new PayPalError("ORDER_ALREADY_AUTHORIZED", "The order has already been authorized.", 422);
      }
      if (order.status !== "APPROVED" || !order.payer) {
        throw new PayPalError("ORDER_NOT_APPROVED", "The payer has not yet approved the order.", 422);
      }
      let vaultId: string | undefined;
      if (order.vault) {
        vaultId = `SIM-V-${id()}`;
        const token: SimVaultToken = { id: vaultId, payer: order.payer, createdAt: this.now().toISOString() };
        await this.save(vaultId, "vault_token", token);
      }
      const auth = this.newAuthorization(order, vaultId);
      await this.save(auth.id, "authorization", auth);
      await this.save(order.id, "order", { ...order, status: "COMPLETED", authorizationId: auth.id });
      return this.toAuthInfo(auth);
    });
  }

  authorizeWithVault(input: {
    vaultId: string;
    amount: string;
    currency: string;
    description: string;
    customId: string;
    requestId: string;
  }): Promise<AuthorizationInfo> {
    return this.idempotent("authorize_vault", input.requestId, async () => {
      assertPositive(input.amount);
      const token = await this.load<SimVaultToken>(input.vaultId, "vault_token");
      const order: SimOrder = {
        id: `SIM-O-${id()}`,
        status: "COMPLETED",
        amount: normalizeAmount(input.amount),
        currency: input.currency,
        description: input.description,
        customId: input.customId,
        vault: false,
        returnUrl: "",
        cancelUrl: "",
        payer: token.payer,
        createdAt: this.now().toISOString(),
      };
      const auth = this.newAuthorization(order, input.vaultId);
      order.authorizationId = auth.id;
      await this.save(order.id, "order", order);
      await this.save(auth.id, "authorization", auth);
      return this.toAuthInfo(auth);
    });
  }

  async getAuthorization(authorizationId: string): Promise<AuthorizationInfo> {
    return this.toAuthInfo(await this.load<SimAuthorization>(authorizationId, "authorization"));
  }

  // ─── payments ─────────────────────────────────────────────────────────────

  capture(authorizationId: string, input: CaptureInput): Promise<CaptureInfo> {
    return this.idempotent("capture", input.requestId, async () => {
      const auth = await this.load<SimAuthorization>(authorizationId, "authorization");
      this.assertCapturable(auth);
      if (input.currency !== auth.currency) {
        throw new PayPalError("CURRENCY_MISMATCH", "Capture currency must match the authorization.", 422);
      }
      assertPositive(input.amount);
      if (auth.captureIds.length >= MAX_CAPTURES) {
        throw new PayPalError("MAX_CAPTURE_COUNT_EXCEEDED", "Maximum number of captures reached.", 422);
      }
      const cents = toCents(input.amount);
      const authorized = toCents(auth.amount);
      const ceiling = Math.min(Math.round(authorized * 1.15), authorized + 7500);
      if (auth.capturedCents + cents > ceiling) {
        throw new PayPalError(
          "MAX_CAPTURE_AMOUNT_EXCEEDED",
          `Capture would exceed the maximum capturable amount (${fromCents(ceiling - auth.capturedCents)} left).`,
          422,
        );
      }
      if (input.invoiceId && (await this.invoiceIdUsed(input.invoiceId))) {
        throw new PayPalError("DUPLICATE_TRANSACTION", "Duplicate invoice Id detected.", 422);
      }

      const capture: SimCapture = {
        captureId: `SIM-C-${id()}`,
        authorizationId,
        status: "COMPLETED",
        amount: { value: normalizeAmount(input.amount), currency: input.currency },
        finalCapture: input.finalCapture,
        invoiceId: input.invoiceId,
        noteToPayer: input.noteToPayer,
        refundedCents: 0,
        createdAt: this.now().toISOString(),
      };
      await this.save(capture.captureId, "capture", capture);
      await this.save(authorizationId, "authorization", {
        ...auth,
        capturedCents: auth.capturedCents + cents,
        captureIds: [...auth.captureIds, capture.captureId],
        status: input.finalCapture ? "CAPTURED" : "PARTIALLY_CAPTURED",
      } satisfies SimAuthorization);
      return stripCapture(capture);
    });
  }

  voidAuthorization(
    authorizationId: string,
    { requestId }: { requestId: string },
  ): Promise<AuthorizationInfo> {
    return this.idempotent("void", requestId, async () => {
      const auth = await this.load<SimAuthorization>(authorizationId, "authorization");
      if (auth.status === "VOIDED") {
        throw new PayPalError("PREVIOUSLY_VOIDED", "The authorization has already been voided.", 422);
      }
      if (auth.status === "CAPTURED") {
        throw new PayPalError(
          "PREVIOUSLY_CAPTURED",
          "The authorization has already been fully captured.",
          422,
        );
      }
      const voided: SimAuthorization = { ...auth, status: "VOIDED" };
      await this.save(authorizationId, "authorization", voided);
      return this.toAuthInfo(voided);
    });
  }

  reauthorize(
    authorizationId: string,
    input: { amount: string; currency: string; requestId: string },
  ): Promise<AuthorizationInfo> {
    return this.idempotent("reauthorize", input.requestId, async () => {
      const auth = await this.load<SimAuthorization>(authorizationId, "authorization");
      this.assertCapturable(auth);
      if (auth.reauthorizedFrom || auth.reauthorizedTo) {
        throw new PayPalError(
          "REAUTHORIZATION_LIMIT_REACHED",
          "An authorization can be reauthorized once.",
          422,
        );
      }
      if (this.now() < new Date(auth.honorUntil)) {
        throw new PayPalError(
          "REAUTHORIZATION_TOO_SOON",
          "A reauthorization is only allowed once from Day 4 to Day 29 since the date of the original authorization.",
          422,
        );
      }
      assertPositive(input.amount);
      if (toCents(input.amount) > Math.round(toCents(auth.amount) * 1.15)) {
        throw new PayPalError(
          "MAX_REAUTHORIZE_AMOUNT_EXCEEDED",
          "Reauthorization exceeds 115% of the original.",
          422,
        );
      }
      const now = this.now();
      const fresh: SimAuthorization = {
        ...auth,
        id: `SIM-A-${id()}`,
        status: "CREATED",
        amount: normalizeAmount(input.amount),
        capturedCents: 0,
        captureIds: [],
        createdAt: now.toISOString(),
        honorUntil: new Date(now.getTime() + HONOR_PERIOD_DAYS * DAY).toISOString(),
        reauthorizedFrom: auth.id,
      };
      await this.save(fresh.id, "authorization", fresh);
      await this.save(auth.id, "authorization", { ...auth, status: "VOIDED", reauthorizedTo: fresh.id });
      return this.toAuthInfo(fresh);
    });
  }

  refundCapture(
    captureId: string,
    input: { amount: string; currency: string; requestId: string; note?: string },
  ): Promise<RefundInfo> {
    return this.idempotent("refund", input.requestId, async () => {
      const capture = await this.load<SimCapture>(captureId, "capture");
      if (capture.status === "REFUNDED") {
        throw new PayPalError("CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded.", 422);
      }
      assertPositive(input.amount);
      const cents = toCents(input.amount);
      const captured = toCents(capture.amount.value);
      if (capture.refundedCents + cents > captured) {
        throw new PayPalError("REFUND_AMOUNT_EXCEEDED", "Refund exceeds the captured amount.", 422);
      }
      const refundedCents = capture.refundedCents + cents;
      await this.save(captureId, "capture", {
        ...capture,
        refundedCents,
        status: refundedCents === captured ? "REFUNDED" : "PARTIALLY_REFUNDED",
      } satisfies SimCapture);
      const refund: SimRefund = {
        refundId: `SIM-R-${id()}`,
        status: "COMPLETED",
        amount: { value: normalizeAmount(input.amount), currency: input.currency },
        captureId,
        createdAt: this.now().toISOString(),
      };
      await this.save(refund.refundId, "refund", refund);
      return { refundId: refund.refundId, status: refund.status, amount: refund.amount };
    });
  }

  // ─── payouts ──────────────────────────────────────────────────────────────

  async createPayout(input: PayoutInput): Promise<PayoutInfo> {
    // Like the sandbox: a sender_batch_id can be used once; a repeat is rejected, not replayed.
    const db = await this.db();
    const key = `payout:${input.senderBatchId}`;
    const [used] = await db.select().from(paypalSimIdempotency).where(eq(paypalSimIdempotency.key, key));
    if (used) throw duplicatePayout(input.senderBatchId);
    return this.idempotent("payout", input.senderBatchId, async () => {
      if (input.items.length === 0)
        throw new PayPalError("VALIDATION_ERROR", "A payout needs at least one item.", 400);
      for (const item of input.items) {
        assertPositive(item.amount);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item.receiver)) {
          throw new PayPalError("RECEIVER_INVALID", `Invalid receiver email: ${item.receiver}`, 400);
        }
      }
      const payout: SimPayout = {
        batchId: `SIM-P-${id()}`,
        senderBatchId: input.senderBatchId,
        status: "SUCCESS",
        items: input.items.map((i) => ({
          itemId: `SIM-PI-${id()}`,
          senderItemId: i.senderItemId,
          receiver: i.receiver,
          amount: { value: normalizeAmount(i.amount), currency: i.currency },
          // Mirrors PayPal: money sent to an address with no PayPal account sits UNCLAIMED.
          status: i.receiver.endsWith(".invalid") ? "UNCLAIMED" : "SUCCESS",
        })),
        createdAt: this.now().toISOString(),
      };
      await this.save(payout.batchId, "payout", payout);
      return stripPayout(payout);
    });
  }

  async getPayout(batchId: string): Promise<PayoutInfo> {
    return stripPayout(await this.load<SimPayout>(batchId, "payout"));
  }

  // ─── webhooks & reporting ─────────────────────────────────────────────────

  /** The simulator has no webhooks; events are recorded directly. Nothing external verifies. */
  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  async searchTransactions({
    startDate,
    endDate,
  }: {
    startDate: Date;
    endDate: Date;
  }): Promise<TransactionSummary[]> {
    const db = await this.db();
    const rows = await db
      .select()
      .from(paypalSimObjects)
      .where(and(gte(paypalSimObjects.createdAt, startDate), lte(paypalSimObjects.createdAt, endDate)));
    const out: TransactionSummary[] = [];
    for (const row of rows) {
      if (row.kind === "capture") {
        const c = row.data as SimCapture;
        out.push({
          id: c.captureId,
          type: "capture",
          status: c.status,
          amount: c.amount,
          at: c.createdAt,
          invoiceId: c.invoiceId,
          refId: c.authorizationId,
        });
      } else if (row.kind === "payout") {
        const p = row.data as SimPayout;
        for (const i of p.items) {
          out.push({
            id: i.itemId ?? p.batchId,
            type: "payout",
            status: i.status ?? p.status,
            amount: { ...i.amount, value: `-${i.amount.value}` },
            at: p.createdAt,
            refId: p.batchId,
          });
        }
      } else if (row.kind === "refund") {
        const r = row.data as SimRefund;
        out.push({
          id: r.refundId,
          type: "refund",
          status: r.status,
          amount: { ...r.amount, value: `-${r.amount.value}` },
          at: r.createdAt,
        });
      } else if (row.kind === "authorization") {
        const a = row.data as SimAuthorization;
        out.push({
          id: a.id,
          type: "authorization",
          status: a.status,
          amount: { value: a.amount, currency: a.currency },
          at: a.createdAt,
        });
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private newAuthorization(order: SimOrder, vaultId?: string): SimAuthorization {
    const now = this.now();
    return {
      id: `SIM-A-${id()}`,
      orderId: order.id,
      status: "CREATED",
      amount: order.amount,
      currency: order.currency,
      capturedCents: 0,
      captureIds: [],
      createdAt: now.toISOString(),
      honorUntil: new Date(now.getTime() + HONOR_PERIOD_DAYS * DAY).toISOString(),
      expiresAt: new Date(now.getTime() + AUTHORIZATION_VALID_DAYS * DAY).toISOString(),
      vaultId,
      payer: order.payer,
    };
  }

  private assertCapturable(auth: SimAuthorization): void {
    if (auth.reauthorizedTo) {
      throw new PayPalError(
        "AUTHORIZATION_VOIDED",
        `Superseded by reauthorization ${auth.reauthorizedTo}.`,
        422,
      );
    }
    if (auth.status === "VOIDED")
      throw new PayPalError("AUTHORIZATION_VOIDED", "The authorization has been voided.", 422);
    if (auth.status === "CAPTURED") {
      throw new PayPalError(
        "AUTHORIZATION_ALREADY_CAPTURED",
        "The authorization has been fully captured.",
        422,
      );
    }
    if (this.now() > new Date(auth.expiresAt)) {
      throw new PayPalError("AUTHORIZATION_EXPIRED", "The authorization has expired.", 422);
    }
  }

  private async invoiceIdUsed(invoiceId: string): Promise<boolean> {
    const db = await this.db();
    const captures = await db.select().from(paypalSimObjects).where(eq(paypalSimObjects.kind, "capture"));
    return captures.some((r) => (r.data as SimCapture).invoiceId === invoiceId);
  }

  private toHoldOrder(o: SimOrder): HoldOrder {
    return {
      orderId: o.id,
      status: o.status,
      approveUrl:
        o.status === "PAYER_ACTION_REQUIRED" || o.status === "CREATED"
          ? `/sim/paypal/checkout?token=${encodeURIComponent(o.id)}`
          : undefined,
      payerEmail: o.payer?.email,
    };
  }

  private toAuthInfo(a: SimAuthorization): AuthorizationInfo {
    return {
      authorizationId: a.id,
      orderId: a.orderId,
      status: a.status,
      amount: { value: a.amount, currency: a.currency },
      capturedTotal: fromCents(a.capturedCents),
      honorUntil: a.honorUntil,
      expiresAt: a.expiresAt,
      vaultId: a.vaultId,
      payerEmail: a.payer?.email,
      payerId: a.payer?.payerId,
    };
  }
}

function assertPositive(amount: string): void {
  let cents: number;
  try {
    cents = toCents(amount);
  } catch {
    throw new PayPalError("INVALID_PARAMETER_VALUE", `Invalid amount: ${amount}`, 422);
  }
  if (cents <= 0) throw new PayPalError("INVALID_PARAMETER_VALUE", "Amount must be greater than zero.", 422);
}

function stripCapture(c: SimCapture): CaptureInfo {
  return {
    captureId: c.captureId,
    authorizationId: c.authorizationId,
    status: c.status,
    amount: c.amount,
    finalCapture: c.finalCapture,
    invoiceId: c.invoiceId,
  };
}

function stripPayout(p: SimPayout): PayoutInfo {
  return { batchId: p.batchId, senderBatchId: p.senderBatchId, status: p.status, items: p.items };
}
