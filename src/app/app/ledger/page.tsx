import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CircleAlert, RefreshCw, ShieldCheck } from "lucide-react";
import { reconcileAction } from "@/app/actions";
import { LedgerGrid } from "@/components/ledger-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/server/db/client";
import { features } from "@/server/env";
import { ledgerRows } from "@/server/ledger";
import { latestReconciliation } from "@/server/payments/jobs";
import { currentWorkspaceId } from "@/server/views";

export const metadata: Metadata = { title: "Ledger" };

export default function LedgerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ledger</h1>
        <p className="text-muted">
          Every PayPal hold and every payment your agent asked for: what was paid, what waited for you, what
          Leash stopped, and why.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-20" />}>
        <Reconciliation />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[720px]" />}>
        <Ledger />
      </Suspense>
    </div>
  );
}

async function Ledger() {
  await connection();
  const rows = await ledgerRows(await currentWorkspaceId());
  return <LedgerGrid rows={rows} aiLive={features.aiLive} />;
}

async function Reconciliation() {
  await connection();
  const workspaceId = await currentWorkspaceId();
  const r = await latestReconciliation(await getDb(), workspaceId);
  const unavailable = r?.issues.find((i) => i.kind === "search_unavailable");
  const clean = r && !unavailable ? r.issues.length === 0 : null;
  return (
    <Card role="region" aria-label="Reconciliation with PayPal">
      <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {clean === false ? (
            <CircleAlert className="text-block mt-0.5 size-5 shrink-0" aria-hidden />
          ) : (
            <ShieldCheck
              className={clean ? "text-allow mt-0.5 size-5 shrink-0" : "text-muted mt-0.5 size-5 shrink-0"}
              aria-hidden
            />
          )}
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {!r
                ? "Not reconciled with PayPal yet"
                : unavailable
                  ? "Couldn't reconcile with PayPal yet"
                  : clean
                    ? `Reconciled with PayPal: ${r.matched} of ${r.checked} payments match, 0 issues`
                    : `Reconciled with PayPal: ${r.issues.length} issue${r.issues.length === 1 ? "" : "s"} to look at`}
            </p>
            <p className="text-muted text-sm">
              {unavailable
                ? unavailable.note
                : r
                  ? `Every capture, payout and refund Leash recorded in the last 7 days, checked against PayPal's Transaction Search on ${r.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC.`
                  : "Leash checks every capture, payout and refund it made against PayPal's own Transaction Search."}
              {r?.pending
                ? ` ${r.pending} recent payment${r.pending === 1 ? " is" : "s are"} not indexed by PayPal yet.`
                : ""}
            </p>
            {r && !unavailable && r.issues.length ? (
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {r.issues.slice(0, 5).map((i) => (
                  <li key={`${i.kind}-${i.paypalId}`} className="flex flex-wrap items-center gap-2">
                    <Badge tone="block">{i.kind.replace(/_/g, " ")}</Badge>
                    <span>{i.note}</span>
                    <code className="text-muted font-mono text-xs">{i.paypalId}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <form action={reconcileAction} className="shrink-0">
          <Button type="submit" variant="secondary" size="sm">
            <RefreshCw aria-hidden /> Reconcile now
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
