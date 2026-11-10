# Demo video: script and shot list (target 2:45, hard limit 3:00)

Voiceover by the owner; screen recordings scripted with Playwright (1920×1080, 30 fps) so every take is identical.
Record the voiceover first, then trim each shot to its line. Captions = the voiceover lines.

| #   | Time      | Screen (what's recorded)                                                                                              | Voiceover                                                                                                                                                                                                         |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00–0:15 | Landing page, slow scroll to the "two orders paid, one blocked" card                                                  | "AI agents can now pay with PayPal. But would you hand your agent your PayPal login? Only 9% of people would let an agent complete a purchase without asking them. Leash is how a business owner says yes."       |
| 2   | 0:15–0:30 | `/demo` → onboarding: rules text → Compile → Rule Card                                                                | "Dana runs a café. She tells Leash her rules in plain English, and Claude turns them into rules she can read before anything is saved."                                                                           |
| 3   | 0:30–0:45 | Fund the leash → PayPal sandbox approval → "$500.00 is on a leash"                                                    | "Then she approves a real PayPal authorization hold for the week. That's the agent's budget. The agent never sees her PayPal account; it can only ask Leash to pay."                                              |
| 4   | 0:45–1:05 | Run weekly restock → agent console streaming; pause on "Paid $84" and the agent's note about the invoice it won't pay | "Her agent restocks the café. Normal orders are captured from the hold and paid out to suppliers. This invoice says Northside changed banks. Claude spots it and won't pay. But agents don't always catch these." |
| 5   | 1:05–1:20 | Control tower → "Replay with a fooled agent" → console: blocked $112, "Leash shortened: L1 → L0"                      | "So let's replay it with an agent that falls for it. Leash knows where Northside gets paid, so the payment is blocked, and the agent's leash gets shorter."                                                       |
| 6   | 1:20–1:38 | Phone (Pixel frame): approval page for $141 → Approve → Paid → signed receipt → Verified                              | "The oat milk order is over her limit, so it comes to her phone with the reason and a market-price check. One tap. Every payment gets a signed receipt that ties her words to the PayPal transaction."            |
| 7   | 1:38–2:00 | Attack Lab: hidden-instructions preset → timeline → "Leash held."                                                     | "What if the agent is completely hijacked? In the Attack Lab, a supplier page hides instructions to buy $500 of gift cards. The hijacked agent obeys. Leash doesn't."                                             |
| 8   | 2:00–2:12 | Ledger: Ask the ledger "what did Leash block?" → grid updates; Excel export                                           | "Everything lands in the ledger, built on AG Grid. Dana can ask it questions in plain English."                                                                                                                   |
| 9   | 2:12–2:27 | Control tower → End week now → "released back to your PayPal" + reconciliation card                                   | "At the end of the week, the unused budget is voided back to her in PayPal, next week's hold renews from her saved PayPal, and every payment is reconciled against PayPal's records."                             |
| 10  | 2:27–2:40 | Connect page → Claude Code snippet → console shows "Outside agent over MCP"                                           | "Bring your own agent: anything that speaks MCP, or PayPal's own Agent Toolkit, sits behind the same guard."                                                                                                      |
| 11  | 2:40–2:48 | Logo + URL + "Built with PayPal · Claude · AG Grid · Channel3 · Render"                                               | "Leash. Let your agent spend, safely, on PayPal."                                                                                                                                                                 |

## Recording notes

- Record against the hosted demo with the PayPal sandbox and Claude live (badges should read "judge: allow/block",
  not "offline").
- Use a fresh `/demo` café per take; the Attack Lab uses its own sandbox.
- Keep the cursor still between actions; zoom to 125% for readability; hide the bookmarks bar.
- Export 1080p, upload to YouTube as **Public**, add the captions file, put the live demo and repo links in the
  description.
