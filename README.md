# Leash

**Spending controls for AI agents, built on PayPal.**

> PayPal gave AI agents the power to pay. Leash gives people the confidence to let them.

Leash lets a small-business owner give an AI operations agent a **real PayPal-backed weekly budget**. The owner
writes the rules in plain English. The agent can only _ask_ Leash to pay: every request passes a layered guard
(deterministic rules → prompt-injection scanner → AI intent-alignment judge). Allowed purchases are captured from a
PayPal authorization hold and suppliers are paid through PayPal Payouts. Purchases outside the rules go to the owner's
phone for one-tap approval. Attacks such as hidden prompt injections and "we changed banks" invoice fraud are blocked
and explained, and they _shorten the leash_. Every payment carries a signed, publicly verifiable intent receipt.
Unused budget is voided back to the owner at the end of the cycle.

🚧 **Work in progress**: built for the _Build What's Next with PayPal and AI_ hackathon.
See the step-by-step build plan in [`docs/PLAN.md`](docs/PLAN.md).

## Run it locally

Requirements: Node.js 22+. No database or API keys are needed to start: Leash runs fully offline with an embedded
database (PGlite), a PayPal sandbox simulator, catalog fixtures and heuristic AI fallbacks.

```bash
npm install
npm run dev
```

Open http://localhost:3000/demo for a fresh, isolated Bean There Café and follow the story: compile the rules,
approve the weekly PayPal hold (an offline simulator without keys), run the agent, approve on the phone page,
verify the receipt. `npm run demo:restock` tells the same story in the terminal. To switch integrations to live mode, copy `.env.example` to `.env.local` and fill in the
keys you have. `/api/health` reports which integrations are live.

Then try to break it at http://localhost:3000/lab: the **Attack Lab** runs four preset attacks (hidden page
instructions, a "we changed banks" invoice, split payments, double-paying an invoice) and an honest control week,
or your own phishing email or planted page text, each in a fresh sandbox café with simulated PayPal money. A public
kill switch (`LAB_MODE`), a daily AI budget (`LAB_DAILY_BUDGET_USD`) and per-visitor rate limits keep it safe to
leave open.

### Bring your own agent

Create a key under **Connect** (`/app/connect`) and point any MCP client at `/api/mcp` (Streamable HTTP, `Authorization:
Bearer leash_sk_…`). Your agent gets the same tools as Leash's own and meets the same guard: it can look things up and
_ask_ Leash to pay, and nothing it can call sends money anywhere.

```bash
claude mcp add --transport http leash http://localhost:3000/api/mcp --header "Authorization: Bearer leash_sk_…"
```

Claude Desktop and other stdio clients use `npm run mcp:stdio` (a small bridge to the HTTP endpoint) or `mcp-remote`;
the Connect page has copy-paste configs.

Already on **PayPal's Agent Toolkit**? `withLeash()` ([`src/sdk/with-leash.ts`](src/sdk/with-leash.ts)) puts Leash
in front of its money-out tools (`create_refund`, `accept_dispute_claim`): small clean refunds run, big, unstated or
suspicious ones wait for the owner or are blocked, and nothing is refunded twice. See
[`examples/paypal-agent-toolkit`](examples/paypal-agent-toolkit).

| Command                                      | What it does                                                |
| -------------------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                                | Start the dev server                                        |
| `npm test`                                   | Unit tests (Vitest)                                         |
| `npm run test:e2e`                           | End-to-end tests (Playwright, desktop + mobile)             |
| `npm run typecheck` / `npm run lint`         | Static checks                                               |
| `npm run db:generate` / `npm run db:migrate` | Create / apply database migrations                          |
| `npm run jobs:cycles`                        | Allowance scheduler: reauthorize, renew, reconcile          |
| `npm run mcp:stdio`                          | stdio MCP bridge for Claude Desktop (needs `LEASH_API_KEY`) |

## License

[MIT](LICENSE)
