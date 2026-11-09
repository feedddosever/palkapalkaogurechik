# Leash architecture

Leash sits between an AI agent and the business's money. The agent can look things up and **ask** to pay; Leash
decides, and only Leash talks to PayPal.

## Components

| Part            | Where                                   | What it does                                                                 |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| Web app         | `src/app`                               | Onboarding, control tower, agent console, phone approval, ledger, trust, lab |
| Agent tools     | `src/server/agent/tools.ts`             | The only things an agent can call (no tool moves money)                      |
| Ops agent       | `src/server/agent/ops-agent.ts`         | Claude tool loop; a scripted agent stands in offline                         |
| Payment service | `src/server/payments/service.ts`        | Builds the request from Leash's records, runs the guard, executes            |
| Guard           | `src/server/guard/*`, `src/server/ai/*` | Rules → injection scanner → intent judge → combine → autonomy level          |
| PayPal gateway  | `src/server/paypal/*`                   | Sandbox client (APIMatic SDK + typed REST) and a PayPal-faithful simulator   |
| Receipts        | `src/server/receipts/*`                 | Canonical JSON, SHA-256 hash chain, Ed25519 signatures, public verifier      |
| Trust engine    | `src/server/trust/engine.ts`            | Track record, promotion proposals, demotion on attacks                       |
| Cycle jobs      | `src/server/payments/jobs.ts`           | Reauthorize, renew from the vault, reconcile with Transaction Search         |
| Attack Lab      | `src/server/lab/*`                      | Sandboxed preset and custom attacks with a public record                     |
| Outside agents  | `src/server/mcp`, `src/server/agents`   | MCP server, API keys, PayPal Agent Toolkit guard                             |
| Catalog         | `src/server/catalog/*`                  | Demo suppliers + Channel3 product search and market prices                   |

## One payment, end to end

```mermaid
sequenceDiagram
  participant A as Agent
  participant L as Leash
  participant G as Guard
  participant O as Owner (phone)
  participant P as PayPal
  A->>L: request_purchase(product ids, quantities, sources)
  L->>L: Resolve price, category, supplier and payee from the catalog (never from the agent)
  L->>G: Rules · scanner (sources) · judge (owner's task vs request)
  alt ALLOW
    L->>P: Capture from the hold (final_capture=false, PayPal-Request-Id)
    L->>P: Payout to the supplier
    L->>L: Sign the intent receipt (chained to the agent's previous one)
    L-->>A: PAID
  else NEEDS_APPROVAL
    L->>O: Approval with reasons + market check
    O->>L: Approve
    L->>P: Capture + payout
  else BLOCK
    L->>L: Record the reasons; an attack shortens the leash
    L-->>A: BLOCKED (don't retry)
  end
```

Key decisions:

- **Authoritative request building.** The agent sends product ids and quantities (or an inbox message id). Leash
  looks up prices, categories, supplier and payee itself, so a hijacked agent can't relabel gift cards as coffee or
  change where money goes.
- **AI can tighten, never loosen.** The final verdict is the most severe of the layers. Deterministic rules are the
  floor; the scanner and judge can only escalate. If an AI layer fails, the request goes to the owner.
- **Autonomy levels waive approvals, never blocks.** L0 asks for everything; L1–L4 waive specific approval findings
  (repeat purchases, new items in allowed categories, verified new suppliers, the approval limit inside the hold).
- **Idempotency everywhere.** Each request has a key; a retry replays the original result. Every PayPal call sends
  `PayPal-Request-Id`.

## The guard

1. **Rules** (`src/server/guard/rules.ts`): agent paused, hold present and big enough, currency, amount matches the
   items, approval limit, forbidden categories (gift cards, prepaid cards, crypto, money transfer), allowed
   categories and budgets, per-item caps, blocked or new suppliers, unverified suppliers, **new or changed payees**
   (including lookalike domains: the business-email-compromise check), split payments within 24 h, duplicate
   invoices and requests, unusual quantities, prices far above the market.
2. **Injection scanner** (`src/server/ai/scanner.ts`): heuristics plus Claude over every untrusted source the request
   relied on (product pages, emails), quoting the planted text and naming where it came from.
3. **Intent judge** (`src/server/ai/judge.ts`): does this payment follow from the owner's task and rules, or from
   something the agent read? Returns a verdict and risk with reasons; fails closed.

## Money flow

- **Start of the week:** Orders v2 with intent `AUTHORIZE`; the owner approves in PayPal; Leash authorizes and the
  authorization becomes the agent's budget. With vaulting, the owner's PayPal is saved for renewals.
- **Each allowed payment:** a partial capture (`final_capture: false`) for exactly that amount, then a Payout to the
  supplier. The receipt id travels as the capture's `invoice_id`, so PayPal and the receipt point at each other.
- **During the week:** after PayPal's 3-day honor period, the remaining amount is reauthorized once.
- **End of the week:** the remainder is voided; pending approvals expire; next week's hold is authorized from the
  vault with no one present (or the owner is asked when there's no vault). An idle agent's budget isn't renewed.
- **Reconciliation:** captures, payouts and refunds are matched against Transaction Search; recent operations count
  as pending while PayPal indexes them; captures from the business's holds that Leash didn't make are flagged.

## Signed intent receipts

Each payment's receipt contains the owner's rules (hash), the cart, the guard's layers and verdict, and the PayPal
ids. It's canonicalized (RFC 8785-style), hashed with SHA-256, chained to the agent's previous receipt, and signed
with Ed25519. Public keys are published at `/.well-known/leash-keys.json`; `/verify/{id}` checks the hash, the
signature and the chain.

## Simulator

The simulator implements the same gateway interface and persists its state, following PayPal's documented
behaviour: 3-day honor period, 29-day validity, capture limits, one reauthorization after the honor period,
`PayPal-Request-Id` replays, vault tokens, payouts and Transaction Search. A contract test suite pins this behaviour
down; it is written against the gateway interface so the same checks can run against the sandbox client.

## Outside agents

- **MCP** (`/api/mcp`): Streamable HTTP, stateless, per-agent API keys (only a SHA-256 hash is stored), rate limited.
  `npm run mcp:stdio` bridges stdio clients such as Claude Desktop.
- **PayPal Agent Toolkit**: `withLeash()` wraps `create_refund` and `accept_dispute_claim`. Leash checks a `refund`
  request (no hold involved; unstated amounts and dispute concessions always go to the owner; one refund per
  capture), the toolkit runs the call only when allowed, and reports the PayPal id back.

## Data

Drizzle on Postgres (or embedded PGlite for zero-setup runs), with workspace scoping on every table: workspaces,
businesses, agents, mandates (rule versions), cycles (holds), suppliers and payees, inventory, inbox, payment
requests, guard decisions, approvals, PayPal operations, receipts and signing keys, agent runs and events, trust
events, reconciliations, API keys, and the lab's runs and planted text.

## Deployment

`render.yaml` defines the web service (migrations before deploy, `/api/health` check), Postgres, and an hourly cron
job that calls the CRON_SECRET-protected scheduler endpoint over Render's private network. Each `/demo` visit gets an
isolated workspace; public entry points are rate limited.
