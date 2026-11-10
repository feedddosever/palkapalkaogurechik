import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { ArrowDown, ArrowUp, Check, Gauge, Sparkles } from "lucide-react";
import { decideProposalAction, shortenLeashAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { LEVELS } from "@/server/guard/levels";
import type { AutonomyLevel } from "@/server/guard/types";
import { eligibility, refreshProposal, trackRecord } from "@/server/trust/engine";
import { currentWorkspaceId, workspaceBasics } from "@/server/views";

export const metadata: Metadata = { title: "Trust" };

export default function TrustPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leash length</h1>
        <p className="text-muted">
          Your agent earns autonomy with a clean track record and loses it the moment Leash blocks an attack.
          Lengthening always needs your yes; shortening is instant.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[640px]" />}>
        <Trust />
      </Suspense>
    </div>
  );
}

async function Trust() {
  await connection();
  const db = await getDb();
  const { agent } = await workspaceBasics(db, await currentWorkspaceId());
  const proposal = await refreshProposal(db, agent.id);
  const record = await trackRecord(db, agent.id);
  const next = eligibility(record);
  const events = await db
    .select()
    .from(t.trustEvents)
    .where(eq(t.trustEvents.agentId, agent.id))
    .orderBy(desc(t.trustEvents.createdAt))
    .limit(20);
  const level = record.level;
  const pitch = proposal?.evidence as { reasons?: string[]; source?: string } | null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-6">
        {proposal ? (
          <Card className="border-primary/40 shadow-raised">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="text-primary size-4" aria-hidden /> {proposal.reason}
                </CardTitle>
                <Badge tone={pitch?.source === "ai" ? "primary" : "neutral"}>
                  {pitch?.source === "ai" ? "Written by Claude" : "Track record"}
                </Badge>
              </div>
              <CardDescription>
                L{proposal.fromLevel} {LEVELS[proposal.fromLevel as AutonomyLevel].name} → L{proposal.toLevel}{" "}
                {LEVELS[proposal.toLevel as AutonomyLevel].name}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {(pitch?.reasons ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <form action={decideProposalAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="proposalId" value={proposal.id} />
                <Button type="submit" name="decision" value="accept">
                  <ArrowUp aria-hidden /> Lengthen the leash
                </Button>
                <Button type="submit" name="decision" value="decline" variant="ghost">
                  Not now
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>The ladder</CardTitle>
            <CardDescription>
              What your agent may do without asking, at each level. No level ever unlocks a blocked pattern.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {([0, 1, 2, 3, 4] as const).map((l) => (
                <li
                  key={l}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3",
                    l === level ? "border-primary bg-accent" : "border-border",
                    // Levels not reached yet: dashed, not faded (faded text fails contrast).
                    l > level ? "bg-surface-muted/40 border-dashed" : "",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                      l <= level ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted",
                    )}
                  >
                    L{l}
                  </span>
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {LEVELS[l].name} {l === level ? <Badge tone="primary">current</Badge> : null}
                    </span>
                    <span className="text-muted text-sm">{LEVELS[l].summary}</span>
                  </div>
                  {l < level ? (
                    <form action={shortenLeashAction}>
                      <input type="hidden" name="level" value={l} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`Shorten the leash to L${l}`}
                      >
                        <ArrowDown aria-hidden /> Shorten
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Track record</CardTitle>
            <CardDescription>
              Since {record.since.toISOString().slice(0, 10)}
              {record.lastDemotion
                ? " (last time the leash was shortened)"
                : ` (last ${record.windowDays} days)`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-5">
            <Stat label="Payments" value={record.executed} tone="allow" />
            <Stat label="You approved" value={record.approvalsGranted} />
            <Stat label="You denied" value={record.denials} tone={record.denials ? "review" : "default"} />
            <Stat label="Blocked" value={record.blocks} tone={record.blocks ? "block" : "default"} />
            <Stat
              label="vs market"
              value={
                record.avgVsMarketPct === null
                  ? "–"
                  : `${record.avgVsMarketPct > 0 ? "+" : ""}${record.avgVsMarketPct}%`
              }
              tone={record.avgVsMarketPct !== null && record.avgVsMarketPct < 0 ? "primary" : "default"}
            />
            <Stat label="Saved" value={formatMoney(record.savings)} tone="primary" />
          </CardContent>
          {!proposal && next.nextLevel !== null ? (
            <CardContent className="border-border text-muted border-t pt-4 text-sm">
              <span className="text-foreground font-medium">
                To reach L{next.nextLevel} {LEVELS[next.nextLevel].name}:
              </span>{" "}
              {next.missing.join("; ")}.
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length ? (
              <Timeline>
                {events.map((e, i) => (
                  <TimelineItem
                    key={e.id}
                    last={i === events.length - 1}
                    icon={
                      e.kind === "demoted" ? (
                        <ArrowDown />
                      ) : e.kind === "promoted" ? (
                        <ArrowUp />
                      ) : e.kind === "proposed" ? (
                        <Sparkles />
                      ) : (
                        <Check />
                      )
                    }
                    tone={e.kind === "demoted" ? "block" : e.kind === "promoted" ? "allow" : "review"}
                    title={
                      e.kind === "demoted"
                        ? `Shortened L${e.fromLevel} → L${e.toLevel}`
                        : e.kind === "promoted"
                          ? `Lengthened L${e.fromLevel} → L${e.toLevel}`
                          : `Proposed L${e.fromLevel} → L${e.toLevel} (${e.status})`
                    }
                    meta={e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  >
                    {e.reason}
                  </TimelineItem>
                ))}
              </Timeline>
            ) : (
              <p className="text-muted flex items-center gap-2 text-sm">
                <Gauge className="size-4" aria-hidden /> No changes yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
