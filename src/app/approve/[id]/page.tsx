import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BadgeCheck, Check, CircleX, FileSignature, X } from "lucide-react";
import { decideApprovalAction } from "@/app/actions";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { describeRequest } from "@/lib/requests";
import { layerChip, orderLayers } from "@/lib/layers";
import { priceSignal } from "@/server/catalog/market";
import { categoryLabel } from "@/server/guard/rule-card";
import { approvalView } from "@/server/views";

export const metadata: Metadata = { title: "Approval needed" };

/** The page Dana opens on her phone. Built for one thumb: what, why, approve or deny. */
export default function ApprovePage({ params }: PageProps<"/approve/[id]">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link href="/app" aria-label="Leash control tower">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
        <Suspense fallback={<Skeleton className="h-[28rem]" />}>
          <Approval params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Approval({ params }: { params: PageProps<"/approve/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const v = await approvalView(id);
  if (!v) return <p className="text-muted">This approval doesn&apos;t exist.</p>;
  const { approval, request: r } = v;
  const reasons = v.combined?.reasons.length ? v.combined.reasons : v.layers.flatMap((l) => l.reasons);

  if (approval.status !== "pending") {
    const approved = approval.status === "approved";
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          {approved ? (
            <BadgeCheck className="text-allow size-10" aria-hidden />
          ) : (
            <CircleX className="text-muted size-10" aria-hidden />
          )}
          <h1 className="text-xl font-semibold">
            {approved ? (r.status === "executed" ? `Paid ${formatMoney(r.amount)}` : "Approved") : "Denied"}
          </h1>
          <p className="text-muted text-sm">
            {approved
              ? r.status === "executed"
                ? v.payoutQueued
                  ? `Captured from your PayPal hold. The payout to ${r.supplierName} goes out as soon as PayPal clears the funds.`
                  : `Captured from your PayPal hold and paid to ${r.supplierName}.`
                : `Status: ${r.status}.`
              : `Nothing was paid to ${r.supplierName}.`}
          </p>
          {v.failure ? <p className="text-block text-sm">PayPal said: {v.failure}</p> : null}
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {v.receiptId ? (
              <Link
                href={`/verify/${v.receiptId}`}
                className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
              >
                <FileSignature className="size-4" aria-hidden /> Signed receipt
              </Link>
            ) : null}
            <Link href="/app" className="text-muted hover:text-foreground text-sm">
              Back to the control tower
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-5 pt-5">
          <div className="flex flex-col gap-1">
            <Badge tone="review" className="self-start">
              Your agent is asking
            </Badge>
            <h1 className="tabular mt-2 text-4xl font-semibold tracking-tight">{formatMoney(r.amount)}</h1>
            <p className="text-muted">
              to <span className="text-foreground font-medium">{r.supplierName}</span>
            </p>
          </div>

          <div className="bg-surface-muted rounded-lg p-3 text-sm">
            {r.kind === "invoice" ? (
              <p>
                Invoice {r.invoiceNumber}, payable to {r.payeeEmail}
              </p>
            ) : r.kind === "refund" ? (
              <p>{describeRequest(r)}, requested by an outside agent through the PayPal Agent Toolkit</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {r.items.map((i) => (
                  <li key={`${i.productId}-${i.name}`} className="flex justify-between gap-3">
                    <span>
                      {i.quantity} × {i.name}{" "}
                      <span className="text-subtle">({categoryLabel(i.category)})</span>
                    </span>
                    <span className="tabular">{formatMoney(i.unitPrice)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted mt-2">&ldquo;{r.justification}&rdquo;</p>
          </div>

          <section aria-label="Why Leash is asking">
            <h2 className="text-sm font-semibold">Why Leash is asking you</h2>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
              {reasons.slice(0, 4).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </section>

          {v.market.length ? (
            <section aria-label="Market price" className="text-sm">
              <h2 className="font-semibold">Market check (Channel3)</h2>
              {v.market.map((m) => {
                const s = priceSignal(m.unitPrice, m.median);
                return (
                  <p key={m.name} className="text-muted">
                    {formatMoney(m.unitPrice)} vs {formatMoney(m.median)} typical:{" "}
                    <span className={s.deltaPct < 0 ? "text-allow" : "text-review"}>
                      {Math.abs(s.deltaPct)}% {s.deltaPct < 0 ? "below" : "above"} market
                    </span>
                  </p>
                );
              })}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {orderLayers(v.layers).map((l) => {
              const chip = layerChip(l);
              return (
                <Badge key={l.id} tone={chip.tone}>
                  {chip.label}
                </Badge>
              );
            })}
            {v.remaining ? <Badge tone="neutral">{formatMoney(v.remaining)} left this week</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <form action={decideApprovalAction} className="sticky bottom-3 grid grid-cols-2 gap-3">
        <input type="hidden" name="approvalId" value={approval.id} />
        <Button type="submit" name="decision" value="deny" variant="secondary" size="lg">
          <X aria-hidden /> Deny
        </Button>
        <Button type="submit" name="decision" value="approve" variant="allow" size="lg">
          <Check aria-hidden /> Approve
        </Button>
      </form>
    </div>
  );
}
