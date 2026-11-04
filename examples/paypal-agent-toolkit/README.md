# Leash + PayPal Agent Toolkit

A customer-support agent built on [PayPal's Agent Toolkit](https://www.npmjs.com/package/@paypal/agent-toolkit)
(Vercel AI SDK flavour), with Leash in front of the two tools that send money back out:
`create_refund` and `accept_dispute_claim`.

```ts
const tools = withLeash(toolkit.getTools(), { url: LEASH_URL, apiKey: LEASH_API_KEY, context });
```

What changes for the agent:

- A small refund with a stated amount, from a clean conversation, runs as before. Leash records it and the PayPal
  refund id lands in the owner's ledger.
- A refund over the owner's approval limit, a full refund with no amount, or accepting a dispute waits for the owner
  (the tool returns `{ leash: { status: "needs_approval", … } }`). Once the owner approves on their phone, the same
  call runs.
- A refund pushed by instructions hidden in the customer's message is blocked. The same refund is never run twice.

`withLeash()` lives in [`src/sdk/with-leash.ts`](../../src/sdk/with-leash.ts): dependency-free, it works with any
tool set shaped like `{ [name]: { execute(args) } }`. The Leash side is `POST /api/v1/guard` (check) and
`POST /api/v1/guard/{id}` (report the result), authenticated with a key from **Connect** in the Leash app.

Run it (PayPal sandbox credentials, an Anthropic key, and a running Leash):

```bash
cd examples/paypal-agent-toolkit
npm install
PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… ANTHROPIC_API_KEY=… AI_MODEL=<a Claude model id> \
LEASH_URL=http://localhost:3000 LEASH_API_KEY=leash_sk_… npm start -- "<customer email>"
```

This example isn't part of the main build or CI (it pulls in the toolkit's own dependencies). The wrapper itself is
covered by Leash's tests (`tests/unit/agents/toolkit.test.ts`), which drive it through the real API routes.
