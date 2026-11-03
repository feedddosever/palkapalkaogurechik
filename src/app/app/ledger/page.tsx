import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LedgerGrid } from "@/components/ledger-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { features } from "@/server/env";
import { ledgerRows } from "@/server/ledger";
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
