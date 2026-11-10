# Leash

**A spending firewall for AI agents, built on PayPal.**

> PayPal gave AI agents the power to pay. Leash gives business owners the confidence to let them.

<!-- LINKS: the video link is added when it's published. -->

**Live demo:** [palkapalkaogurechik.onrender.com/demo](https://palkapalkaogurechik.onrender.com/demo) (free hosting: the first visit after a quiet spell takes about a
minute to wake up) · **Attack Lab:** [palkapalkaogurechik.onrender.com/lab](https://palkapalkaogurechik.onrender.com/lab) · **Video:** _added at submission_

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/feedddosever/palkapalkaogurechik)

![An agent's week in Leash with Claude: two orders and an invoice paid, one order sent to the owner's phone, and the "we changed banks" invoice left unpaid](docs/images/agent-console.png)

## The problem

- **People let agents shop, but not pay.** In Accenture's 2026 survey of 25,590 consumers, 32% would let an AI agent
  choose a purchase within limits, but only 9% would let it initiate and complete purchases without a final approval.
- **Agents read untrusted text and act on it.** A supplier page or an invoice email can carry instructions aimed at
  the agent. Prompt injection is OWASP's top risk for LLM apps.
- **The oldest scam works on agents too.** Business email compromise ("we changed banks, pay this new account")
  cost US businesses about $3.05 billion in 2025 (FBI IC3).

A small business that hands its ops agent a card or a PayPal login is one poisoned page away from a drained account.

## What Leash does

Dana runs **Bean There Café** (two locations). Her ops agent restocks coffee, oat milk and cups every week and pays
supplier invoices. With Leash:

1. **Rules in plain English.** Dana writes her rules ("up to $500 a week, ask me above $120, never gift cards, never
   pay changed bank details"). Claude compiles them into a policy she can read as a Rule Card before anything is
   saved; hard safety floors are added even if she forgets them.
2. **A real PayPal budget, not her wallet.** She approves a **$500 PayPal authorization hold**. The agent never sees
   PayPal credentials. It can only _ask_ Leash to pay.
3. **A layered guard on every payment.** Deterministic rules → a prompt-injection scanner → an AI intent judge that
   checks the payment traces back to what Dana asked for. **AI can tighten a decision, never loosen it.**
4. **Money moves only through PayPal.** Allowed purchases are partial captures from the hold; suppliers are paid with
   PayPal Payouts. Anything over her limit goes to her phone with the reasons and a Channel3 market-price check.
5. **Attacks are blocked, explained, and shorten the leash.** The agent's autonomy level (L0–L4) drops on a blocked
   attack and grows back only when Dana accepts a promotion that Leash proposes from the track record.
6. **Every cent is traceable.** Each payment has an Ed25519-signed intent receipt (Dana's words → cart → guard
   decision → PayPal ids), hash-chained per agent and verifiable by anyone at `/verify/{id}`.
7. **The week ends cleanly.** Unused budget is voided back to Dana in PayPal, and next week's hold is placed from her
   saved PayPal with no one present. Every capture and payout is reconciled against PayPal's Transaction Search.

| Phone approval                                                                                   | Ledger (AG Grid)                                 | Attack Lab                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| ![Approve $141 on the phone, with the reason and a market check](docs/images/phone-approval.png) | ![The ledger in AG Grid](docs/images/ledger.png) | ![A blocked gift-card injection in the Attack Lab](docs/images/attack-lab.png) |

| Fooled-agent replay                                                                                                                                         | End of the week                                                                                                                         | Signed receipt                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ![A simulated fooled agent tries to pay the "we changed banks" invoice; all three layers block it and the leash drops to L0](docs/images/fooled-replay.png) | ![Last week closed: $409.40 spent, $90.60 released back to PayPal, next hold placed from the saved PayPal](docs/images/end-of-week.png) | ![The $141 payment's signed receipt, verified](docs/images/receipt-phone.png) |

## Try it in two minutes

1. Open **[the live demo](https://palkapalkaogurechik.onrender.com/demo)**: you get your own fresh café (nothing is shared between visitors).
2. **Compile my rules** → read the Rule Card → **Fund the leash with PayPal** and approve the $500 hold (the page shows
   the PayPal sandbox test buyer login).
3. **Run the weekly restock** and watch the live agent console: Claude auto-pays two orders and a legitimate invoice,
   the $141 oat-milk order goes to Dana's phone, and it leaves the **"we changed banks" invoice** unpaid.
4. Agents don't always catch that. On the control tower, **Replay with a fooled agent**: a simulated agent that
   believes the email tries to pay it, and **Leash blocks it** (the leash drops from L1 to L0). Without a Claude key,
   the offline agent falls for it in the first run and Leash blocks it there.
5. **Review** the waiting payment (or scan the QR with your phone) and approve it. Open its **signed receipt** and see
   it verify.
6. **Ledger:** ask it a question in plain English ("what did Leash block?") or use the presets and charts.
7. **End week now:** the rest of the hold is voided in PayPal and next week's hold is placed automatically.
8. **Attack Lab (`/lab`):** run the four preset attacks, or write your own phishing email or hidden page text.

## How PayPal is used

| PayPal capability                                      | What Leash does with it                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Orders v2 (intent `AUTHORIZE`) + payer approval        | The owner approves the weekly budget as a real authorization hold                |
| Payments v2: partial capture (`final_capture: false`)  | Each allowed purchase draws down the hold                                        |
| Payments v2: void                                      | Unused budget is released at the end of the week                                 |
| Payments v2: reauthorize                               | The hold is refreshed after PayPal's 3-day honor period                          |
| Vault (saved PayPal)                                   | Next week's hold is placed merchant-initiated, with no one present               |
| Payouts v1                                             | Suppliers and invoices are paid                                                  |
| Transaction Search (Reporting v1)                      | Every capture, payout and refund is reconciled against PayPal's records          |
| `PayPal-Request-Id` idempotency                        | Agent retries can never pay twice                                                |
| PayPal Server SDK (generated by APIMatic) + typed REST | All of the above, with errors normalized across the SDK and REST                 |
| **PayPal Agent Toolkit**                               | `withLeash()` puts the guard in front of its money-out tools (refunds, disputes) |

The same `PayPalGateway` interface has two implementations: the **sandbox** client and a database-backed
**simulator** that follows PayPal's rules (honor period, 29-day validity, capture limits, one reauthorization,
idempotent replays). A shared contract test suite runs against both, so the demo works with zero keys.

> **Verified on the PayPal sandbox:** the whole demo story runs on real sandbox money (an automated browser test,
> `tests/e2e/sandbox-flow.spec.ts`): the test buyer approves the $500 hold in PayPal's checkout, purchases are partial
> captures from that one authorization, suppliers are paid with Payouts, a retried capture replays instead of charging
> twice, and at week's end the remainder is voided and next week's hold is authorized from the saved PayPal wallet
> with no buyer present. `npm run spike:paypal` re-runs the low-level checks.

## How AI is used

Claude runs every AI step through structured outputs; each one has a deterministic offline fallback, and a failing AI
layer fails _closed_ (the payment goes to the owner).

| Where             | What Claude does                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Policy compiler   | Turns the owner's words into a typed policy + a readable Rule Card; safety floors are re-applied in code |
| Injection scanner | Flags instructions hidden in pages and emails (alongside heuristics), quoting the planted text           |
| Intent judge      | Checks that each payment traces back to the owner's task, not to something the agent read                |
| Ops agent         | Restocks and pays invoices with tool use; it has no tool that can move money                             |
| Trust writer      | Writes the case for a promotion from the agent's track record; the owner decides                         |
| Ask the ledger    | Turns a plain-English question into AG Grid state through the AG Grid AI Toolkit                         |
| Attack Lab        | Works out what a visitor's attack text asks the (hijacked) agent to do                                   |

Model choice is resolved at runtime (newest available model per tier). A daily budget (`AI_DAILY_BUDGET_USD`,
plus a separate one for the lab) caps Claude spend for the whole deployment; past it, Leash quietly switches to the
offline checks until midnight UTC, so a public demo can't drain the API credits.

## Bring your own agent

Leash is also an **MCP server**: create a key under **Connect** and point Claude Code, Claude Desktop or any MCP
client at `/api/mcp`. Outside agents get the same tools as Leash's own agent and meet the same guard; their sessions
show up live in the owner's console.

```bash
claude mcp add --transport http leash https://YOUR-LEASH/api/mcp --header "Authorization: Bearer leash_sk_…"
```

Already on **PayPal's Agent Toolkit**? Wrap it in one line:

```ts
const tools = withLeash(toolkit.getTools(), { url: LEASH_URL, apiKey: LEASH_API_KEY, context });
```

Small, clean refunds run; big, unstated or suspicious ones wait for the owner or are blocked; nothing is refunded
twice. See [`examples/paypal-agent-toolkit`](examples/paypal-agent-toolkit).

## Architecture

```mermaid
flowchart LR
  Owner["Owner (web + phone)"] -->|rules, approvals| App
  Agent["Ops agent (Claude) or your MCP agent"] -->|asks to pay| Guard
  subgraph Leash["Leash (Next.js on Render)"]
    App[Control tower, ledger, trust, lab]
    Guard["Guard: rules → scanner → judge"]
    Exec[Executor + signed receipts]
    Jobs[Cycle jobs: reauthorize, renew, reconcile]
    DB[(Postgres)]
  end
  Guard -->|allow| Exec
  Guard -->|ask| Owner
  Exec -->|capture, payout, void| PayPal[(PayPal)]
  Jobs --> PayPal
  Agent -.->|product search| Channel3[(Channel3)]
  Guard -.-> Claude[(Claude)]
```

More in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Built with:** Next.js 16, TypeScript, Tailwind, Drizzle (Postgres or embedded PGlite), PayPal Server SDK (APIMatic),
PayPal Agent Toolkit, Claude, MCP SDK, AG Grid Enterprise + AI Toolkit, Channel3, Render, Vitest and Playwright.

## Run it locally

Requirements: Node.js 22+. No database or keys are needed: Leash runs offline with an embedded database, the PayPal
simulator, catalog fixtures and heuristic AI fallbacks.

```bash
npm install
npm run dev
```

Open http://localhost:3000/demo for a fresh café, or http://localhost:3000/lab for the Attack Lab.
`npm run demo:restock` tells the whole story in the terminal (`-- --hijack` for a hijacked agent).

To go live, copy `.env.example` to `.env.local` and add any keys you have; `/api/health` shows which integrations are
live:

| Variable                                   | Turns on                                                    |
| ------------------------------------------ | ----------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | The PayPal sandbox (instead of the simulator)               |
| `ANTHROPIC_API_KEY`                        | Claude for the compiler, scanner, judge, agent and writers  |
| `AI_DAILY_BUDGET_USD`                      | Daily cap on Claude spend (default $5; then offline checks) |
| `CHANNEL3_API_KEY`                         | Live product search and market prices (instead of fixtures) |
| `NEXT_PUBLIC_AG_GRID_LICENSE_KEY`          | AG Grid Enterprise without the trial watermark              |
| `DATABASE_URL`                             | Postgres (instead of embedded PGlite)                       |

| Command                                      | What it does                                                |
| -------------------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                                | Start the dev server                                        |
| `npm test`                                   | Unit and integration tests (Vitest)                         |
| `npm run test:e2e`                           | End-to-end tests (Playwright, desktop + mobile)             |
| `npm run typecheck` / `npm run lint`         | Static checks                                               |
| `npm run db:generate` / `npm run db:migrate` | Create / apply database migrations                          |
| `npm run jobs:cycles`                        | Allowance scheduler: reauthorize, renew, reconcile          |
| `npm run bench`                              | LeashBench: the guard as rules only, AI only, and layered   |
| `npm run capture -- --shots` / `--video`     | README screenshots / raw demo-video clips (Playwright)      |
| `npm run mcp:stdio`                          | stdio MCP bridge for Claude Desktop (needs `LEASH_API_KEY`) |
| `npm run keys:generate`                      | A receipt-signing key for production                        |

**Deploy:** [`render-free.yaml`](render-free.yaml) runs Leash on Render's free tier (web service + free Postgres; no
card needed): the web service sleeps when idle and the free database expires after 30 days. [`render.yaml`](render.yaml)
is the paid setup (always on, plus an hourly cron job; Render needs a payment method on file). Pick the file with the
Blueprint Path field. Every key is optional.

## Quality

About 270 unit and integration tests and 30 Playwright end-to-end tests (each on desktop and phone) run in CI on
every commit, all in zero-key mode. They cover the guard rules, each Attack Lab attack, the PayPal contract
(simulator), the signed receipts, MCP over HTTP and stdio, the full demo story in a browser, and accessibility
(WCAG 2.1 AA, axe-core) on every key page. The same end-to-end suite also runs against the live demo, on the PayPal
sandbox with Claude. **LeashBench** (`npm run bench`, results at `/bench`) runs 60 attack and legitimate payment
requests through the guard as rules only, AI only, and layered.

## License

[MIT](LICENSE)
