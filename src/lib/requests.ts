/** One-line descriptions of a payment request, shared by the views, the ledger and the approval page. */

type Describable = {
  kind: "purchase" | "invoice" | "refund";
  supplierName: string;
  invoiceNumber?: string | null;
  items: { quantity: number; name: string }[];
};

export const DISPUTE_CONCESSION = "Dispute concession";
export const CUSTOMER_REFUND = "Customer refund";

export function describeRequest(r: Describable): string {
  if (r.kind === "invoice") return `Invoice ${r.invoiceNumber ?? ""}`.trim();
  if (r.kind === "refund") {
    return r.supplierName === DISPUTE_CONCESSION
      ? `Accept dispute ${r.invoiceNumber ?? ""}`.trim()
      : `Refund of PayPal capture ${r.invoiceNumber ?? ""}`.trim();
  }
  return r.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");
}

export function requestEventLabel(kind: Describable["kind"]): "Purchase" | "Invoice" | "Refund" {
  return kind === "invoice" ? "Invoice" : kind === "refund" ? "Refund" : "Purchase";
}
