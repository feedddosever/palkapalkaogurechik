import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { and, eq } from "drizzle-orm";
import { BadgeCheck, Bot } from "lucide-react";
import { runAgentAction } from "@/app/actions";
import { LeashMeter } from "@/components/leash-meter";
import { Logo } from "@/components/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import type { AutonomyLevel } from "@/server/guard/types";
import { activateCycle } from "@/server/payments/cycles";
import { currentWorkspaceId, workspaceBasics } from "@/server/views";

export const metadata: Metadata = { title: "Your agent's budget is ready" };

/** PayPal (or the simulator) returns here with ?token=<order id> after the owner approves the hold. */
export default function Funded({ searchParams }: PageProps<"/onboarding/funded">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Leash home">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 sm:px-6">
        <Suspense fallback={<Skeleton className="h-80" />}>
          <Activate searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function Activate({ searchParams }: { searchParams: PageProps<"/onboarding/funded">["searchParams"] }) {
  await connection();
  const { token } = await searchParams;
  const db = await getDb();
  const workspaceId = await currentWorkspaceId();
  const [cycle] = await db
    .select()
    .from(t.cycles)
    .where(and(eq(t.cycles.paypalOrderId, String(token ?? "")), eq(t.cycles.workspaceId, workspaceId)));
  if (!cycle) {
    return (
      <p className="text-muted">
        We couldn&apos;t find that PayPal approval.{" "}
        <Link className="text-primary underline" href="/app">
          Go to the control tower
        </Link>
        .
      </p>
    );
  }
  let active;
  try {
    active = await activateCycle(db, cycle.id);
  } catch (err) {
    return (
      <p role="alert" className="text-block">
        PayPal didn&apos;t confirm the hold ({err instanceof Error ? err.message : "error"}).{" "}
        <Link className="underline" href="/onboarding">
          Try again
        </Link>
        .
      </p>
    );
  }
  const { agent } = await workspaceBasics(db, workspaceId);
  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6">
        <div className="flex items-start gap-3">
          <BadgeCheck className="text-allow size-8 shrink-0" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {formatMoney(active.amount)} is on a leash
            </h1>
            <p className="text-muted mt-1">
              PayPal is holding this week&apos;s budget. Your agent can only draw from it through Leash, and
              only within your rules.
            </p>
          </div>
        </div>
        <LeashMeter
          held={Number(active.amount)}
          spent={Number(active.capturedTotal)}
          level={agent.autonomyLevel as AutonomyLevel}
        />
        <div className="flex flex-wrap gap-2">
          <form action={runAgentAction}>
            <input type="hidden" name="mode" value="standard" />
            <Button type="submit">
              <Bot aria-hidden /> Run the weekly restock
            </Button>
          </form>
          <ButtonLink href="/app" variant="secondary">
            Open the control tower
          </ButtonLink>
        </div>
      </CardContent>
    </Card>
  );
}
