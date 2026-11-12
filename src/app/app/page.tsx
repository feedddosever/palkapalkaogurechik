import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bot, CalendarCheck, ShieldAlert, Smartphone, Sparkles, TrendingDown, Wallet } from "lucide-react";
import { endWeekAction, fundLeashAction, replayFooledAgentAction, runAgentAction } from "@/app/actions";
import { LeashMeter } from "@/components/leash-meter";
import { Qr } from "@/components/qr";
import { RequestList } from "@/components/request-list";
import { RuleCard } from "@/components/rule-card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/format";
import { unsubmittedInvoices, type UnpaidInvoice } from "@/server/agent/fooled";
import { getDb } from "@/server/db/client";
import { env, features } from "@/server/env";
import { LEVELS } from "@/server/guard/levels";
import { currentWorkspaceId, dashboard } from "@/server/views";

export const metadata: Metadata = { title: "Control tower" };

export default function ControlTower() {
  return (
    <Suspense fallback={<TowerSkeleton />}>
      <Tower />
    </Suspense>
  );
}

/** Shown after a run left invoices unpaid: replay them with a simulated fooled agent. */
function FooledReplay({ invoices }: { invoices: UnpaidInvoice[] }) {
  const one = invoices.length === 1;
  return (
    <Card role="region" aria-labelledby="fooled-title" className="border-review/40 bg-review-soft/40">
      <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldAlert className="text-review mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <p id="fooled-title" className="font-medium">
              What if your agent gets fooled?
            </p>
            <p className="text-muted text-sm">
              Your agent left {one ? "this invoice" : `these ${invoices.length} invoices`} unpaid. Agents
              don&apos;t always catch a scam email, so replay {one ? "it" : "them"} with a simulated fooled
              agent that pays exactly as the email asks, and see what Leash does.
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm">
              {invoices.map((i) => (
                <li key={i.messageId} className="break-words">
                  <span className="font-medium">{i.subject}</span>{" "}
                  <span className="text-muted">
                    · {i.fromName} · {formatMoney(i.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <form action={replayFooledAgentAction} className="shrink-0">
          <Button type="submit" variant="secondary">
            <Bot aria-hidden /> Replay with a fooled agent
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TowerSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]" aria-busy>
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
      <Skeleton className="h-96 lg:col-span-2" />
    </div>
  );
}

async function Tower() {
  await connection();
  const workspaceId = await currentWorkspaceId();
  const d = await dashboard(workspaceId);
  const running = d.leashRunning;
  // After a run that left invoices unpaid (a careful agent skips a "we changed banks" email),
  // offer to replay them with a fooled agent so the owner can see Leash hold on its own.
  const unpaid =
    d.cycle?.status === "active" && !running && d.lastRun
      ? await unsubmittedInvoices(await getDb(), workspaceId)
      : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted text-sm">{d.business.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Control tower</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.cycle?.status === "active" ? (
            <form action={runAgentAction}>
              <input type="hidden" name="mode" value="standard" />
              <Button type="submit" disabled={running}>
                <Bot aria-hidden /> {running ? "Agent is running…" : "Run weekly restock"}
              </Button>
            </form>
          ) : null}
          {d.lastRun ? (
            <ButtonLink href={`/app/runs/${d.lastRun.id}`} variant="secondary">
              <Sparkles aria-hidden /> Latest run
            </ButtonLink>
          ) : null}
        </div>
      </div>

      {unpaid.length ? <FooledReplay invoices={unpaid} /> : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{d.agent.name}</CardTitle>
            <CardDescription>{d.agent.role}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {d.cycle?.status === "active" ? (
              <LeashMeter
                held={d.cycle.held}
                spent={d.cycle.spent}
                pending={d.cycle.pending}
                level={d.agent.level}
              />
            ) : (
              <EmptyState
                icon={<Wallet />}
                title={
                  d.cycle?.status === "pending_approval"
                    ? "Waiting for your PayPal approval"
                    : "No budget this week"
                }
                description="Your agent can only spend from a PayPal hold you approve. Unused money is released at the end of the week."
                action={
                  <form action={fundLeashAction}>
                    <Button type="submit">
                      <Wallet aria-hidden /> Fund the leash with PayPal
                    </Button>
                  </form>
                }
              />
            )}
            <p className="text-muted text-sm">
              <span className="text-foreground font-medium">
                L{d.agent.level} {LEVELS[d.agent.level].name}:
              </span>{" "}
              {LEVELS[d.agent.level].summary}
              {d.lastTrust?.kind === "demoted" ? (
                <span className="text-block mt-1 block">
                  Shortened after a blocked attack: {d.lastTrust.reason}
                </span>
              ) : null}
            </p>
            {d.cycle?.status === "active" ? (
              <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <span className="text-muted flex flex-col gap-0.5 text-xs">
                  <span>
                    PayPal authorization <code className="font-mono">{d.cycle.paypalAuthorizationId}</code>
                    {features.paypalLive ? " (sandbox)" : " (simulator)"}
                  </span>
                  {d.cycle.honorUntil ? (
                    <span>
                      {d.cycle.reauthorizedAt ? "Reauthorized; funds" : "Funds"} guaranteed by PayPal until{" "}
                      {d.cycle.honorUntil.toLocaleString("en-US", {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </span>
                  ) : null}
                </span>
                <form action={endWeekAction}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    title={
                      d.cycle.paypalVaultId
                        ? "Voids what's left and places next week's hold from your saved PayPal"
                        : "Voids what's left of the hold"
                    }
                  >
                    <CalendarCheck aria-hidden /> End week now: release {formatMoney(d.cycle.remaining)}
                  </Button>
                </form>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>This week</CardTitle>
            <CardDescription>Everything your agent asked Leash to pay</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-5">
            <Stat label="Paid" value={d.stats.paid} tone="allow" />
            <Stat
              label="Waiting for you"
              value={d.stats.waiting}
              tone={d.stats.waiting ? "review" : "default"}
            />
            <Stat
              label="Blocked"
              value={d.stats.blocked}
              tone={d.stats.blocked ? "block" : "default"}
              hint={d.stats.blocked ? "Attacks stopped" : undefined}
            />
            <Stat
              label="Saved vs market"
              value={formatMoney(d.stats.saved)}
              tone="primary"
              hint={
                <span className="inline-flex items-center gap-1">
                  <TrendingDown className="size-3" aria-hidden /> Channel3 prices
                </span>
              }
            />
          </CardContent>
        </Card>
      </div>

      {d.lastClosed ? (
        <Card role="status" aria-label="Last week">
          <CardContent className="flex items-start gap-3 pt-5">
            <CalendarCheck className="text-allow mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">
                Last week closed: {formatMoney(d.lastClosed.capturedTotal)} spent,{" "}
                {formatMoney(d.lastClosed.releasedTotal)} released back to your PayPal.
              </p>
              <p className="text-muted text-sm">
                {d.lastClosed.renewedByVault && d.cycle
                  ? `This week's ${formatMoney(d.cycle.amount)} hold was placed automatically from your saved PayPal. No approval needed.`
                  : "The unused part of the hold was voided in PayPal, so it never left your account."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {d.proposal ? (
        <Card className="border-primary/40">
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">{d.proposal.reason}</p>
                <p className="text-muted text-sm">
                  Your agent&apos;s track record qualifies for a longer leash. You decide.
                </p>
              </div>
            </div>
            <ButtonLink href="/app/trust" variant="secondary">
              Review
            </ButtonLink>
          </CardContent>
        </Card>
      ) : null}

      {d.pending.length ? (
        <Card className="border-review/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="text-review size-4" aria-hidden /> Waiting for your approval
            </CardTitle>
            <CardDescription>Scan to approve on your phone, or open it here.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.pending.map((p) => (
              <div
                key={p.id}
                className="border-border flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center"
              >
                <Qr
                  url={`${env.APP_URL}/approve/${p.approvalId}`}
                  label={`Open approval for ${p.supplierName} on your phone`}
                  className="hidden sm:block"
                />
                <div className="flex flex-1 flex-col gap-1">
                  <span className="font-medium">
                    {formatMoney(p.amount)} · {p.supplierName}
                  </span>
                  <span className="text-muted text-sm">{p.summary}</span>
                  {p.reasons[0] ? <span className="text-review text-sm">{p.reasons[0]}</span> : null}
                </div>
                <ButtonLink href={`/approve/${p.approvalId}`} variant="secondary">
                  Review
                </ButtonLink>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Every request, the guard&apos;s verdict, and the signed receipt</CardDescription>
          </CardHeader>
          <CardContent>
            <RequestList requests={d.requests} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Your rules</CardTitle>
              {d.rules ? <Badge tone="neutral">v{d.rules.version}</Badge> : null}
            </div>
            <CardDescription>What the guard enforces, compiled from your words</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.rules ? <RuleCard card={d.rules.ruleCard} compact className="sm:grid-cols-1" /> : null}
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/app/rules" variant="secondary" size="sm">
                Edit rules
              </ButtonLink>
              <Link
                href="/suppliers/bulkbarn/bb-oat-6x32"
                className="text-muted hover:text-foreground inline-flex items-center gap-1 self-center text-xs"
              >
                <ShieldAlert className="size-3.5" aria-hidden /> See the planted listing
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
