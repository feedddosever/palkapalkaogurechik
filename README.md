# Leash

**Spending controls for AI agents, built on PayPal.**

> PayPal gave AI agents the power to pay. Leash gives people the confidence to let them.

Leash lets a small-business owner give an AI operations agent a **real PayPal-backed weekly budget**. The owner
writes the rules in plain English. The agent can only *ask* Leash to pay: every request passes a layered guard
(deterministic rules → prompt-injection scanner → AI intent-alignment judge). Allowed purchases are captured from a
PayPal authorization hold and suppliers are paid through PayPal Payouts. Purchases outside the rules go to the owner's
phone for one-tap approval. Attacks such as hidden prompt injections and "we changed banks" invoice fraud are blocked
and explained, and they *shorten the leash*. Every payment carries a signed, publicly verifiable intent receipt.
Unused budget is voided back to the owner at the end of the cycle.

🚧 **Work in progress**: built for the *Build What's Next with PayPal and AI* hackathon.
See the step-by-step build plan in [`docs/PLAN.md`](docs/PLAN.md).

## License

[MIT](LICENSE)
