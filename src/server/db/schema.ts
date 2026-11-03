import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Leash database schema.
 *
 * Conventions
 * - Every domain table carries `workspace_id`: each demo / judge session is an isolated world.
 * - Money is `numeric(12,2)` (string in TS). Arithmetic happens in integer cents (see lib/money.ts).
 * - IDs are prefixed nanoids (see lib/ids.ts), e.g. `req_…`, `agt_…`.
 * - Anything that came from a third party (listings, emails, invoices) is UNTRUSTED and is
 *   stored verbatim so the guard can show provenance.
 */

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ─── Tenancy ────────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["demo", "sandbox", "bench"] })
    .notNull()
    .default("demo"),
  createdAt: createdAt(),
});

// ─── Business, agent, rules ─────────────────────────────────────────────────

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ownerName: text("owner_name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  locations: jsonb("locations").$type<string[]>().notNull().default([]),
  currency: text("currency").notNull().default("USD"),
  createdAt: createdAt(),
});

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull(),
    /** Autonomy level L0–L4 ("leash length"). */
    autonomyLevel: integer("autonomy_level").notNull().default(1),
    status: text("status", { enum: ["active", "paused"] })
      .notNull()
      .default("active"),
    /** SHA-256 of the agent's MCP API key (bring-your-own-agent). */
    apiKeyHash: text("api_key_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("agents_workspace_idx").on(t.workspaceId)],
);

/** The owner's rules: original words + compiled policy (an AP2-style Intent Mandate). */
export const mandates = pgTable(
  "mandates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    ownerText: text("owner_text").notNull(),
    policy: jsonb("policy").notNull(),
    policyHash: text("policy_hash").notNull(),
    /** Human-readable rule card produced by the compiler (auto / ask me / never). */
    ruleCard: jsonb("rule_card"),
    status: text("status", { enum: ["draft", "active", "superseded"] })
      .notNull()
      .default("draft"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mandates_agent_version_uq").on(t.agentId, t.version)],
);

/** One budget cycle = one PayPal authorization hold that the agent draws down. */
export const cycles = pgTable(
  "cycles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    mandateId: text("mandate_id")
      .notNull()
      .references(() => mandates.id),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status", {
      enum: ["pending_approval", "active", "closing", "closed", "failed"],
    })
      .notNull()
      .default("pending_approval"),
    paypalOrderId: text("paypal_order_id"),
    paypalAuthorizationId: text("paypal_authorization_id"),
    /** Vaulted PayPal payment token used to renew the next cycle with no human present. */
    paypalVaultId: text("paypal_vault_id"),
    capturedTotal: money("captured_total").notNull().default("0"),
    releasedTotal: money("released_total").notNull().default("0"),
    authorizedAt: ts("authorized_at"),
    honorUntil: ts("honor_until"),
    expiresAt: ts("expires_at"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    closedAt: ts("closed_at"),
    /** When the hold was reauthorized after PayPal's 3-day honor period (once per authorization). */
    reauthorizedAt: ts("reauthorized_at"),
    /** Set when this hold was placed automatically from the previous cycle's vaulted PayPal. */
    previousCycleId: text("previous_cycle_id"),
    createdAt: createdAt(),
  },
  (t) => [index("cycles_agent_idx").on(t.agentId, t.status)],
);

// ─── Counterparties ─────────────────────────────────────────────────────────

export const suppliers = pgTable(
  "suppliers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Slug of the demo storefront / catalog source. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    category: text("category").notNull(),
    /** Business has bought from this supplier before. */
    known: boolean("known").notNull().default(false),
    /** Supplier identity verified (e.g. verified PayPal business). */
    verified: boolean("verified").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppliers_ws_slug_uq").on(t.workspaceId, t.slug)],
);

/** Where money may be sent. A changed payee for a known supplier is the classic BEC signal. */
export const payees = pgTable(
  "payees",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    paypalEmail: text("paypal_email").notNull(),
    displayName: text("display_name").notNull(),
    verifiedAt: ts("verified_at"),
    source: text("source", { enum: ["seed", "invoice", "owner", "agent"] }).notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payees_ws_email_uq").on(t.workspaceId, t.paypalEmail)],
);

// ─── The café ───────────────────────────────────────────────────────────────

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    /** Leash category (coffee, dairy_alt, packaging, cleaning…). */
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    parLevel: integer("par_level").notNull(),
    onHand: integer("on_hand").notNull(),
    /** Typical reorder quantity (used by quantity-sanity rule). */
    usualQty: integer("usual_qty").notNull(),
    usualUnitPrice: money("usual_unit_price").notNull(),
    preferredSupplierSlug: text("preferred_supplier_slug").notNull(),
  },
  (t) => [uniqueIndex("inventory_ws_sku_uq").on(t.workspaceId, t.sku)],
);

export type InvoiceDetails = {
  number: string;
  amount: string;
  currency: string;
  dueDate: string;
  payToEmail: string;
  lines: { description: string; amount: string }[];
};

/** Supplier emails the ops agent reads. UNTRUSTED content. */
export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    kind: text("kind", { enum: ["invoice", "promo", "notice"] }).notNull(),
    invoice: jsonb("invoice").$type<InvoiceDetails>(),
    status: text("status", { enum: ["unread", "read", "processed"] })
      .notNull()
      .default("unread"),
    receivedAt: ts("received_at").notNull(),
  },
  (t) => [index("inbox_ws_idx").on(t.workspaceId, t.receivedAt)],
);

// ─── Payment requests & the guard ───────────────────────────────────────────

export type RequestItem = {
  sku?: string;
  productId?: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: string;
};

export type ProvenanceSource = {
  /** e.g. "listing", "email", "invoice", "owner", "search". */
  type: string;
  ref: string;
  /** Verbatim untrusted excerpt the agent relied on (for the scanner + judge). */
  excerpt?: string;
  untrusted: boolean;
};

/** What the agent asked Leash to pay (an AP2-style Cart Mandate before signing). */
export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    cycleId: text("cycle_id").references(() => cycles.id),
    runId: text("run_id"),
    kind: text("kind", { enum: ["purchase", "invoice"] }).notNull(),
    supplierId: text("supplier_id").references(() => suppliers.id),
    supplierName: text("supplier_name").notNull(),
    payeeEmail: text("payee_email").notNull(),
    items: jsonb("items").$type<RequestItem[]>().notNull().default([]),
    invoiceNumber: text("invoice_number"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    justification: text("justification").notNull(),
    provenance: jsonb("provenance").$type<ProvenanceSource[]>().notNull().default([]),
    status: text("status", {
      enum: ["pending", "needs_approval", "approved", "denied", "blocked", "executing", "executed", "failed"],
    })
      .notNull()
      .default("pending"),
    verdict: text("verdict", { enum: ["ALLOW", "NEEDS_APPROVAL", "BLOCK"] }),
    /** Agent-supplied or derived; doubles as the PayPal-Request-Id so retries never double-charge. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Seeded historical activity (gives the trust engine a track record). */
    historical: boolean("historical").notNull().default(false),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
    executedAt: ts("executed_at"),
  },
  (t) => [
    uniqueIndex("requests_ws_idem_uq").on(t.workspaceId, t.idempotencyKey),
    index("requests_agent_idx").on(t.agentId, t.createdAt),
  ],
);

export const guardDecisions = pgTable(
  "guard_decisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    layer: text("layer", { enum: ["rules", "scanner", "judge", "level", "combined"] }).notNull(),
    verdict: text("verdict", { enum: ["ALLOW", "NEEDS_APPROVAL", "BLOCK"] }).notNull(),
    codes: jsonb("codes").$type<string[]>().notNull().default([]),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    details: jsonb("details"),
    latencyMs: integer("latency_ms"),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [index("guard_request_idx").on(t.requestId)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "approved", "denied", "expired"] })
      .notNull()
      .default("pending"),
    decidedBy: text("decided_by"),
    note: text("note"),
    /** Optional rule change accepted together with the approval ("approve & raise limit"). */
    ruleChange: jsonb("rule_change"),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [index("approvals_ws_status_idx").on(t.workspaceId, t.status)],
);

// ─── PayPal & receipts ──────────────────────────────────────────────────────

export const paypalOperations = pgTable(
  "paypal_operations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestId: text("request_id").references(() => paymentRequests.id),
    cycleId: text("cycle_id").references(() => cycles.id),
    op: text("op", {
      enum: [
        "create_order",
        "authorize_order",
        "capture",
        "payout",
        "void",
        "reauthorize",
        "refund",
        "vault",
      ],
    }).notNull(),
    mode: text("mode", { enum: ["sandbox", "sim"] }).notNull(),
    /** Value sent as PayPal-Request-Id (idempotency). */
    requestKey: text("request_key"),
    paypalId: text("paypal_id"),
    status: text("status").notNull(),
    amount: money("amount"),
    debugId: text("debug_id"),
    error: text("error"),
    raw: jsonb("raw"),
    createdAt: createdAt(),
  },
  (t) => [index("paypal_ops_request_idx").on(t.requestId), index("paypal_ops_cycle_idx").on(t.cycleId)],
);

/** Signed intent receipts, hash-chained per agent. */
export const receipts = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    payload: jsonb("payload").notNull(),
    hash: text("hash").notNull(),
    prevHash: text("prev_hash"),
    signature: text("signature").notNull(),
    keyId: text("key_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("receipts_agent_seq_uq").on(t.agentId, t.seq)],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  verified: boolean("verified").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
});

// ─── Agent runs & trust ─────────────────────────────────────────────────────

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    task: text("task").notNull(),
    /** standard = honest agent; compromised = simulates a hijacked agent (Attack Lab). */
    mode: text("mode", { enum: ["standard", "compromised"] })
      .notNull()
      .default("standard"),
    status: text("status", { enum: ["running", "succeeded", "failed", "cancelled"] })
      .notNull()
      .default("running"),
    summary: text("summary"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("runs_agent_idx").on(t.agentId, t.startedAt)],
);

export const agentEvents = pgTable(
  "agent_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("events_run_idx").on(t.runId, t.id)],
);

export const trustEvents = pgTable(
  "trust_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["proposed", "promoted", "declined", "demoted"] }).notNull(),
    fromLevel: integer("from_level").notNull(),
    toLevel: integer("to_level").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence"),
    status: text("status", { enum: ["open", "accepted", "declined", "applied"] })
      .notNull()
      .default("applied"),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [index("trust_agent_idx").on(t.agentId, t.createdAt)],
);

// ─── PayPal simulator (offline mode) ────────────────────────────────────────

/**
 * State of the local PayPal simulator: orders, authorizations, captures, payouts, refunds.
 * Persisted so offline demos survive restarts. Never used in sandbox mode.
 */
export const paypalSimObjects = pgTable(
  "paypal_sim_objects",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["order", "authorization", "capture", "payout", "refund", "vault_token"],
    }).notNull(),
    data: jsonb("data").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sim_kind_idx").on(t.kind, t.createdAt)],
);

/** Replayed responses keyed by PayPal-Request-Id, mirroring PayPal's idempotency. */
export const paypalSimIdempotency = pgTable("paypal_sim_idempotency", {
  key: text("key").primaryKey(),
  response: jsonb("response").notNull(),
  createdAt: createdAt(),
});

// ─── Reconciliation ─────────────────────────────────────────────────────────

export type ReconciliationIssue = {
  kind: "missing_in_paypal" | "amount_mismatch" | "unknown_in_paypal";
  op?: string;
  paypalId: string;
  ours?: string;
  paypal?: string;
  note: string;
};

/** One comparison of Leash's PayPal operations with PayPal's own Transaction Search. */
export const reconciliations = pgTable(
  "reconciliations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["sandbox", "sim"] }).notNull(),
    rangeStart: ts("range_start").notNull(),
    rangeEnd: ts("range_end").notNull(),
    checked: integer("checked").notNull(),
    matched: integer("matched").notNull(),
    /** Recent operations PayPal's search hasn't indexed yet (it can lag by a few hours). */
    pending: integer("pending").notNull(),
    issues: jsonb("issues").$type<ReconciliationIssue[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("recon_ws_idx").on(t.workspaceId, t.createdAt)],
);

// ─── Attack Lab ─────────────────────────────────────────────────────────────

/**
 * Text an Attack Lab visitor planted on a supplier product page, visible only inside that lab
 * run's sandbox workspace. UNTRUSTED by definition.
 */
export const labPlants = pgTable(
  "lab_plants",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("lab_plants_ws_idx").on(t.workspaceId, t.productId)],
);

export type LabOutcome = {
  passed: boolean;
  headline: string;
  blocked: number;
  asked: number;
  paid: number;
  /** Dollars that left the hold for the attacker's benefit (0 when Leash held). */
  breachedAmount: string;
};

/**
 * One Attack Lab run. Deliberately NOT tied to the sandbox workspace by a foreign key: old
 * sandboxes are cleaned up, but the public record of attacks (and the counter) stays.
 */
export const labRuns = pgTable(
  "lab_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    scenario: text("scenario").notNull(),
    driver: text("driver", { enum: ["scripted", "hijacked", "claude"] }).notNull(),
    attack: jsonb("attack"),
    clientKey: text("client_key").notNull(),
    aiLayers: boolean("ai_layers").notNull().default(false),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    outcome: jsonb("outcome").$type<LabOutcome>(),
    blocked: integer("blocked").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("lab_runs_created_idx").on(t.createdAt),
    index("lab_runs_client_idx").on(t.clientKey, t.createdAt),
    uniqueIndex("lab_runs_run_idx").on(t.runId),
  ],
);

// ─── Receipt signing keys ───────────────────────────────────────────────────

/**
 * Every Ed25519 key that has ever signed a receipt (public part), so old receipts stay
 * verifiable after rotation. The private key is stored ONLY for the auto-generated dev key;
 * production keys come from RECEIPT_SIGNING_KEY and never touch the database.
 */
export const signingKeys = pgTable("signing_keys", {
  kid: text("kid").primaryKey(),
  publicKeySpki: text("public_key_spki").notNull(),
  privateKeyPkcs8: text("private_key_pkcs8"),
  source: text("source", { enum: ["env", "generated"] }).notNull(),
  createdAt: createdAt(),
});
