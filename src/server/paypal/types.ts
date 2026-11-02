/**
 * The PayPal surface Leash uses, as one interface with two implementations:
 *  - `sandbox`: the real PayPal sandbox via the official Server SDK + typed REST (sandbox.ts)
 *  - `sim`: a local, PayPal-faithful simulator for offline development and tests (simulator.ts)
 *
 * Every mutating call takes a `requestId` that is sent as `PayPal-Request-Id`, so retries
 * (by the agent, the executor, or the network) can never double-charge.
 */

export type Money = { value: string; currency: string };

export type OrderStatus = "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";

export type AuthorizationStatus =
  "CREATED" | "CAPTURED" | "DENIED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING";

export type HoldOrder = {
  orderId: string;
  status: OrderStatus;
  /** Where the payer approves the hold (PayPal checkout, or the simulator's approval page). */
  approveUrl?: string;
  payerEmail?: string;
  debugId?: string;
};

export type AuthorizationInfo = {
  authorizationId: string;
  orderId?: string;
  status: AuthorizationStatus;
  amount: Money;
  /** Total captured so far against this authorization. */
  capturedTotal?: string;
  /** PayPal guarantees funds until the honor period ends (3 days). */
  honorUntil?: string;
  /** After this the authorization can no longer be captured (29 days). */
  expiresAt?: string;
  /** Vaulted PayPal wallet token, when the payer agreed to save PayPal for future holds. */
  vaultId?: string;
  payerEmail?: string;
  payerId?: string;
  debugId?: string;
};

export type CaptureInfo = {
  captureId: string;
  authorizationId: string;
  status: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  amount: Money;
  finalCapture: boolean;
  invoiceId?: string;
  debugId?: string;
};

export type RefundInfo = { refundId: string; status: string; amount: Money; debugId?: string };

export type PayoutItemInfo = {
  itemId?: string;
  senderItemId: string;
  receiver: string;
  amount: Money;
  status?: string;
};

export type PayoutInfo = {
  batchId: string;
  senderBatchId: string;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";
  items: PayoutItemInfo[];
  debugId?: string;
};

export type TransactionSummary = {
  id: string;
  /** authorization | capture | void | payout | refund (normalized from PayPal event codes). */
  type: string;
  status: string;
  amount: Money;
  at: string;
  invoiceId?: string;
};

export type CreateHoldOrderInput = {
  amount: string;
  currency: string;
  description: string;
  /** Our cycle id: travels with the order as custom_id. */
  customId: string;
  invoiceId?: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
  /** Ask the payer to save PayPal so future holds can be placed with no one present. */
  vault?: boolean;
  requestId: string;
};

export type CaptureInput = {
  amount: string;
  currency: string;
  /** false keeps the rest of the hold open for later captures. */
  finalCapture: boolean;
  requestId: string;
  /** Shown in PayPal; we put the signed intent-receipt id here. */
  invoiceId?: string;
  noteToPayer?: string;
};

export type PayoutInput = {
  /** Unique per batch; doubles as the idempotency key. */
  senderBatchId: string;
  emailSubject: string;
  items: { receiver: string; amount: string; currency: string; note: string; senderItemId: string }[];
};

export interface PayPalGateway {
  readonly mode: "sandbox" | "sim";

  createHoldOrder(input: CreateHoldOrderInput): Promise<HoldOrder>;
  getOrder(orderId: string): Promise<HoldOrder>;
  /** Turns an approved order into an authorization hold. */
  authorizeOrder(orderId: string, opts: { requestId: string }): Promise<AuthorizationInfo>;
  /** Merchant-initiated hold on a vaulted PayPal wallet: no payer present (cycle renewal). */
  authorizeWithVault(input: {
    vaultId: string;
    amount: string;
    currency: string;
    description: string;
    customId: string;
    requestId: string;
  }): Promise<AuthorizationInfo>;
  getAuthorization(authorizationId: string): Promise<AuthorizationInfo>;

  capture(authorizationId: string, input: CaptureInput): Promise<CaptureInfo>;
  voidAuthorization(authorizationId: string, opts: { requestId: string }): Promise<AuthorizationInfo>;
  reauthorize(
    authorizationId: string,
    input: { amount: string; currency: string; requestId: string },
  ): Promise<AuthorizationInfo>;
  refundCapture(
    captureId: string,
    input: { amount: string; currency: string; requestId: string; note?: string },
  ): Promise<RefundInfo>;

  createPayout(input: PayoutInput): Promise<PayoutInfo>;
  getPayout(batchId: string): Promise<PayoutInfo>;

  verifyWebhook(input: {
    headers: Record<string, string | undefined>;
    event: unknown;
    webhookId: string;
  }): Promise<boolean>;
  searchTransactions(input: { startDate: Date; endDate: Date }): Promise<TransactionSummary[]>;
}

/** A PayPal API failure, normalized across the SDK, raw REST and the simulator. */
export class PayPalError extends Error {
  constructor(
    /** PayPal issue code (e.g. AUTHORIZATION_EXPIRED) or error name. */
    readonly code: string,
    message: string,
    readonly httpStatus?: number,
    readonly debugId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }

  get retriable(): boolean {
    return this.httpStatus === undefined || this.httpStatus === 429 || this.httpStatus >= 500;
  }
}

export const HONOR_PERIOD_DAYS = 3;
export const AUTHORIZATION_VALID_DAYS = 29;
