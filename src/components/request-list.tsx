import Link from "next/link";
import { CircleX, FileSignature, Hand, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/format";
import type { RequestView } from "@/server/views";

const statusText: Record<string, string> = {
  executed: "Paid",
  needs_approval: "Waiting for you",
  approved: "Approved",
  denied: "Denied",
  blocked: "Blocked",
  failed: "Failed",
  executing: "Paying…",
};

function StatusBadge({ status, verdict }: { status: string; verdict: string | null }) {
  if (status === "executed") {
    return (
      <Badge tone="allow">
        <ShieldCheck aria-hidden /> {verdict === "NEEDS_APPROVAL" ? "Paid · approved by you" : "Paid"}
      </Badge>
    );
  }
  if (status === "needs_approval") {
    return (
      <Badge tone="review">
        <ShieldQuestion aria-hidden /> Waiting for you
      </Badge>
    );
  }
  if (status === "blocked") {
    return (
      <Badge tone="block">
        <ShieldAlert aria-hidden /> Blocked
      </Badge>
    );
  }
  return (
    <Badge tone={status === "failed" ? "block" : "neutral"}>
      {status === "denied" ? <CircleX aria-hidden /> : null}
      {statusText[status] ?? status}
    </Badge>
  );
}

export function RequestList({ requests, empty }: { requests: RequestView[]; empty?: string }) {
  if (requests.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        description={empty ?? "Run the weekly restock to see your agent at work."}
      />
    );
  }
  return (
    <ul className="divide-border flex flex-col divide-y">
      {requests.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-medium">{r.supplierName}</span>
            <span className="tabular font-semibold">{formatMoney(r.amount)}</span>
          </div>
          <p className="text-muted text-sm">{r.summary}</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} verdict={r.verdict} />
            {r.status === "needs_approval" && r.approvalId ? (
              <Link
                href={`/approve/${r.approvalId}`}
                className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                <Hand className="size-3.5" aria-hidden /> Review
              </Link>
            ) : null}
            {r.receiptId ? (
              <Link
                href={`/verify/${r.receiptId}`}
                className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                <FileSignature className="size-3.5" aria-hidden /> Receipt
              </Link>
            ) : null}
          </div>
          {r.status !== "executed" && r.reasons[0] ? (
            <p className="text-muted text-xs">{r.reasons[0]}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
