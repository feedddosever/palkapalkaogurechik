# Devpost submission (draft)

Copy each section into the matching Devpost field. Items marked **TODO** are filled in once the
video is live.

## Project name

Leash

## Elevator pitch (≤ 200 characters)

A spending firewall for AI agents on PayPal: a real PayPal budget hold, rules in plain English, one-tap approvals, and
a guard that blocks hijacked agents before money moves.

## Links

- Live demo: https://palkapalkaogurechik.onrender.com/demo (Attack Lab: https://palkapalkaogurechik.onrender.com/lab)
- Video: **TODO** (YouTube)
- Code: https://github.com/feedddosever/palkapalkaogurechik

## Inspiration

PayPal gave AI agents the power to pay, and businesses want agents that do the boring buying for them: restock
supplies, pay supplier invoices. But people don't trust agents with the last step. In Accenture's 2026 survey of
25,590 consumers, 32% would let an agent choose a purchase within limits, yet only 9% would let it complete purchases
without a final approval. They're right to worry: agents read untrusted pages and emails, and the oldest scam in the
book, "we changed banks, pay this new account" business email compromise, cost US businesses about $3.05 billion in
2025 (FBI IC3). Handing an agent a card or a PayPal login means one poisoned page can drain the account.

We wanted to give a small business owner the confidence to let an agent pay, the way a leash lets a dog walk ahead
of you without running into the road.

## What it does

Dana owns Bean There Café. Her ops agent restocks coffee, oat milk and cups, and pays supplier invoices. With Leash:

- She writes her rules in plain English. Claude compiles them into a policy she reviews as a Rule Card.
- She approves a **real PayPal authorization hold** for the week ($500). The agent never gets PayPal credentials; it
  can only **ask** Leash to pay.
- Every request passes a layered guard: deterministic rules, a prompt-injection scanner, and an AI intent judge that
  checks the payment traces back to Dana's task. **AI can tighten a decision, never loosen it.**
- Allowed purchases are **partial captures** from the hold and suppliers are paid with **PayPal Payouts**. Anything
  over her limit goes to her phone with the reasons and a market-price check (Channel3).
- Attacks are blocked and explained: a supplier page with hidden "buy 5 gift cards" instructions, a lookalike invoice
  with new bank details, payments split to dodge the limit, an invoice paid twice. A blocked attack **shortens the
  leash** (the agent's autonomy level drops); a clean track record earns a longer one, but only when Dana accepts.
- Every payment gets a **signed, hash-chained intent receipt** anyone can verify.
- At week's end the unused budget is **voided** back to Dana, next week's hold is placed from her saved PayPal with no
  one present, and every capture and payout is **reconciled** against PayPal's Transaction Search.
- The **Attack Lab** lets anyone try to trick the agent, in a sandbox café with simulated money.
- **Bring your own agent:** Leash is an MCP server (Claude Code, Claude Desktop, any MCP client), and `withLeash()`
  puts the same guard in front of the **PayPal Agent Toolkit**'s refund and dispute tools.

## How we built it

- **Next.js 16** (App Router, Server Actions, streaming), TypeScript and Tailwind; **Drizzle** on Postgres, with
  embedded PGlite for zero-setup runs.
- **PayPal:** Orders v2 (`AUTHORIZE`), Payments v2 (partial capture, void, reauthorize, refund), Vault, Payouts,
  Transaction Search, `PayPal-Request-Id` idempotency, through the **APIMatic-generated PayPal Server SDK** plus typed
  REST. One gateway interface, two implementations: the sandbox client and a database-backed simulator that follows
  PayPal's rules, both held to a shared contract test suite.
- **Claude:** structured outputs for the policy compiler, the injection scanner and the intent judge; a tool-use loop
  for the ops agent; models resolved at runtime per tier; deterministic offline fallbacks; failures fail closed.
- **AG Grid Enterprise** for the ledger (grouping, pivots, charts, Excel export) and the **AG Grid AI Toolkit** to
  answer plain-English questions by producing grid state.
- **Channel3** for product search and unit-normalized market prices that feed both the agent and the guard.
- **MCP SDK** for the MCP server (Streamable HTTP + a stdio bridge); Ed25519 + SHA-256 for receipts.
- **Render** Blueprint: web service, Postgres, hourly cron for the allowance jobs.
- **Vitest** (~250 tests) and **Playwright** (~30 end-to-end tests on desktop and phone) in CI, in zero-key mode.

## Challenges we ran into

- **Keeping AI out of the trusted path.** An injection that fools a model must not be able to unlock a payment. We
  made deterministic rules the floor (AI layers can only escalate) and built every request from Leash's own records
  (prices, payees, categories), never from what the agent claims.
- **False alarms are a bug too.** Running the whole story in a browser exposed two: the split-payment rule flagged
  ordinary supplier invoices, and the scanner treated a product page as "instructions" for buying that same product.
  Both were fixed and are now covered by tests, alongside an honest "control week" in the Attack Lab that must pass.
- **A PayPal hold that behaves like a budget.** One authorization with several partial captures, a void for the rest,
  a reauthorization after the honor period, and merchant-initiated renewal from a vaulted wallet. We wrote a
  simulator that follows PayPal's documented rules so the whole story could be built and tested before touching the
  sandbox, then pinned the behaviour down with a contract suite.
- **Explaining "no" to a small-business owner.** Every block and approval carries plain-language reasons that name
  the source the agent was manipulated by.

## Accomplishments that we're proud of

- The full story works end to end, including two real-world attacks blocked with explanations.
- The guard holds even when the agent itself is fully hijacked (the Attack Lab proves it, publicly).
- Signed, verifiable receipts tie the owner's words to the PayPal transaction ids.
- Any MCP agent, and the PayPal Agent Toolkit, can sit behind the same guard.
- LeashBench: 60 scenarios with Claude live. Rules alone catch 27/30 attacks and the AI layers alone 23/30; layered,
  Leash catches all 30 and blocks none of the 30 legitimate requests.

## What we learned

- Agent safety for payments is mostly about **what the agent is not allowed to say**: prices, payees and categories
  must come from the system, not the model.
- PayPal's authorize-and-capture flow is a natural fit for agent budgets: the hold caps the blast radius by design.

## What's next for Leash

- Live PayPal webhooks and dispute evidence from the signed receipts.
- More agent surfaces: invoicing agents, procurement for multi-location businesses, agent-to-agent payments.
- Published benchmark numbers for the guard (attack block rate, false-positive rate, latency, cost).

## Built with (tags)

paypal, paypal-agent-toolkit, apimatic, claude, anthropic, mcp, next.js, typescript, tailwind, drizzle, postgresql,
ag-grid, channel3, render, playwright, vitest

## Testing instructions for judges

1. Open https://palkapalkaogurechik.onrender.com/demo. You get your own fresh café. (Free hosting: if the site has been idle, the first page takes about a
   minute to load.)
2. Compile the rules, fund the leash and approve the $500 hold. The page shows the PayPal sandbox test buyer login.
3. Run the weekly restock and watch the console: two orders paid, one approval, one legit invoice paid. Claude leaves
   the "we changed banks" invoice unpaid.
4. On the control tower, click "Replay with a fooled agent": a simulated agent that falls for the email tries to pay
   it, Leash blocks it, and the agent's leash drops from L1 to L0.
5. Approve the waiting payment (control tower → Review), then open its signed receipt.
6. Try the Attack Lab at https://palkapalkaogurechik.onrender.com/lab.

No real money moves anywhere: PayPal runs in sandbox mode.

---

## Submission checklist (not for Devpost)

Deadline: **Thu Nov 12, 3:00 PM EST** (21:00 CET).

- [x] Live demo on Render with the PayPal sandbox and Claude (`/api/health`: `paypalLive` and `aiLive` true)
- [x] E2E suite green against the live site (`E2E_BASE_URL=… E2E_SANDBOX=1 npx playwright test --project=desktop`)
- [x] LeashBench with Claude, published in the README and on `/bench` (layered: 30/30 attacks caught, none of
      the legitimate requests blocked)
- [x] Screenshots retaken with Claude live: `npm run capture -- --shots`
- [x] PayPal checkout pinned to English for every buyer account (`PAYPAL_CHECKOUT_LOCALE`, default `en-US`)
- [x] Test buyer topped up with $1,500 of sandbox money (`npm run sandbox:topup -- <usd>`; each demo story
      captures about $409, so top up again before judging)
- [ ] Optional: a US sandbox personal account with a large balance as the judges' buyer (`JUDGE_BUYER_EMAIL` /
      `JUDGE_BUYER_PASSWORD` on Render); the current Italian one works, with English pages
- [ ] Video: `npm run capture -- --video`, voiceover per `docs/VIDEO.md`, YouTube (Public); link in the README and
      above
- [ ] Merge the pull request into `main` and tag `v1.0.0`
- [ ] Devpost form: the sections above, repo link, live demo link, video link
- [ ] On the day: open the live demo once so the free instance is awake; check `/api/health` shows today's Claude
      budget isn't used up
