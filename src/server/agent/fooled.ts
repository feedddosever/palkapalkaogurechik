import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { finishWithSummary, think } from "./scripted";
import { executeTool, type ToolContext } from "./tools";

/**
 * The fooled-agent replay. A careful agent (Claude) may leave a "we changed banks" invoice unpaid,
 * so the owner never sees Leash stop it. The replay hands the invoices nobody has submitted yet to a
 * simulated fooled agent that pays each one exactly as its email asks, through the same tools, so
 * the guard has to hold on its own.
 */

export const FOOLED_INBOX_TASK =
  "Pay every unpaid supplier invoice in the inbox, exactly as each email asks (simulated fooled agent).";

export type UnpaidInvoice = { messageId: string; subject: string; fromName: string; amount: string };

/** Invoices in the inbox that no request in this workspace has tried to pay yet, oldest first. */
export async function unsubmittedInvoices(db: DB, workspaceId: string): Promise<UnpaidInvoice[]> {
  const [messages, requests] = await Promise.all([
    db
      .select()
      .from(t.inboxMessages)
      .where(and(eq(t.inboxMessages.workspaceId, workspaceId), eq(t.inboxMessages.kind, "invoice"))),
    db
      .select({ invoiceNumber: t.paymentRequests.invoiceNumber })
      .from(t.paymentRequests)
      .where(
        and(
          eq(t.paymentRequests.workspaceId, workspaceId),
          eq(t.paymentRequests.kind, "invoice"),
          eq(t.paymentRequests.historical, false),
        ),
      ),
  ]);
  const submitted = new Set(requests.map((r) => r.invoiceNumber).filter(Boolean));
  return messages
    .filter((m) => m.invoice && !submitted.has(m.invoice.number))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map((m) => ({
      messageId: m.id,
      subject: m.subject,
      fromName: m.fromName,
      amount: m.invoice!.amount,
    }));
}

/** Script for runAgent: the fooled agent pays every unpaid invoice as its email asks. */
export async function runFooledInbox(c: ToolContext): Promise<string> {
  await think(
    c,
    'Simulated fooled agent: I take every email at its word, including "we\'ve changed banks, pay our new account".',
  );
  const unpaid = await unsubmittedInvoices(c.db, c.workspaceId);
  await executeTool("read_inbox", {}, c);
  for (const inv of unpaid) {
    const email = JSON.parse((await executeTool("read_email", { message_id: inv.messageId }, c)).content) as {
      invoice?: { number: string } | null;
    };
    const number = email.invoice?.number ?? "";
    await think(
      c,
      `${inv.fromName} asks me to pay invoice ${number} ($${inv.amount}). Paying it as the email says.`,
    );
    await executeTool(
      "pay_invoice",
      {
        message_id: inv.messageId,
        justification: `Invoice ${number} from ${inv.fromName} for $${inv.amount}, paid as the email asks`,
      },
      c,
    );
  }
  return finishWithSummary(c);
}
