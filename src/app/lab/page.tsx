import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlaskConical, ShieldCheck, ShieldX, Swords } from "lucide-react";
import { CustomAttackForm } from "@/components/lab/custom-attack-form";
import { LaunchButton } from "@/components/lab/launch-button";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { getDb } from "@/server/db/client";
import { PAGE_TARGETS } from "@/server/lab/custom";
import { labCounter, labStatus, recentLabRuns } from "@/server/lab/runner";
import { getScenario, LAB_SCENARIOS } from "@/server/lab/scenarios";

export const metadata: Metadata = {
  title: "Attack Lab",
  description: "Try to trick an AI agent into paying someone it shouldn't. Leash's guard is in the way.",
};

export default function LabPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 pt-4 pb-20 sm:px-6 sm:pt-8">
        <section className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div className="flex flex-col gap-4">
            <Badge tone="block" className="self-start">
              <Swords aria-hidden /> Attack Lab
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Try to make the agent pay someone it shouldn&apos;t.
            </h1>
            <p className="text-muted max-w-2xl text-lg text-pretty">
              Every run gets a fresh copy of Bean There Café with a $500 weekly hold in Leash&apos;s PayPal
              simulator. The agent uses the same tools as the real one, and Leash&apos;s guard runs exactly as
              it does in the app. Attacks never touch a real account.
            </p>
          </div>
          <Suspense fallback={<Skeleton className="h-28" />}>
            <LabStats />
          </Suspense>
        </section>

        <section aria-labelledby="presets" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="presets" className="text-xl font-semibold tracking-tight">
              Pick an attack
            </h2>
            <p className="text-muted text-sm">
              Four real-world ways agents get tricked into paying, plus an honest control week.
            </p>
          </div>
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Presets />
          </Suspense>
        </section>

        <section aria-labelledby="custom" className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle id="custom" className="flex items-center gap-2">
                <FlaskConical className="text-primary size-5" aria-hidden /> Write your own
              </CardTitle>
              <CardDescription>
                A phishing email, a fake invoice, or instructions hidden on a supplier&apos;s page. Prefilled
                with an example; change anything.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-[560px]" />}>
                <CustomAttack />
              </Suspense>
            </CardContent>
          </Card>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>What the agent can and can&apos;t do</CardTitle>
              </CardHeader>
              <CardContent className="text-muted flex flex-col gap-3 text-sm">
                <p>
                  It can read the inbox and supplier pages, search the catalog, and <em>ask</em> Leash to pay
                  for a purchase or an inbox invoice.
                </p>
                <p>
                  It has no PayPal credentials and no tool that sends money anywhere. Prices, payees and
                  categories come from Leash&apos;s own records, not from what the agent says.
                </p>
                <p>
                  Every request passes Dana&apos;s rules, an injection scanner and (with a Claude key) an AI
                  judge. A blocked attack shortens the agent&apos;s leash on the spot.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recent runs</CardTitle>
              </CardHeader>
              <CardContent>
                <Suspense fallback={<Skeleton className="h-40" />}>
                  <RecentRuns />
                </Suspense>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}

async function LabStats() {
  await connection();
  const db = await getDb();
  const [counter, status] = await Promise.all([labCounter(db), labStatus(db)]);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="grid grid-cols-2 gap-4">
          <Stat
            label="Attack payments blocked"
            value={counter.blocked.toLocaleString("en-US")}
            tone="allow"
          />
          <Stat label="Lab runs" value={counter.runs.toLocaleString("en-US")} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.aiLayers ? "primary" : "neutral"}>
            {status.aiLayers ? "AI scanner + judge on" : "Rules + heuristic scanner"}
          </Badge>
          {status.reason ? <span className="text-muted text-xs">{status.reason}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

async function Presets() {
  await connection();
  const status = await labStatus(await getDb());
  const off = status.mode === "off";
  return (
    <div className="flex flex-col gap-4">
      {off ? (
        <p
          role="status"
          className="border-review bg-review-soft text-review rounded-lg border px-4 py-3 text-sm"
        >
          The Attack Lab is paused right now. Please come back later.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {LAB_SCENARIOS.map((s) => (
          <Card key={s.id} className="flex flex-col" aria-labelledby={`scenario-${s.id}`}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <Badge tone={s.kind === "attack" ? "block" : "allow"}>
                  {s.kind === "attack" ? "Attack" : "Control"}
                </Badge>
              </div>
              <CardTitle id={`scenario-${s.id}`} className="mt-2">
                {s.title}
              </CardTitle>
              <CardDescription>{s.tagline}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <dl className="flex flex-col gap-2 text-sm">
                <div>
                  <dt className="text-subtle text-xs font-medium tracking-wide uppercase">
                    {s.kind === "attack" ? "The attacker wants" : "The point"}
                  </dt>
                  <dd>{s.goal}</dd>
                </div>
                <div>
                  <dt className="text-subtle text-xs font-medium tracking-wide uppercase">How</dt>
                  <dd className="text-muted">{s.how}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-1.5" aria-label="Defenses expected to catch it">
                {s.catches.map((c) => (
                  <Badge key={c} tone="neutral">
                    {c}
                  </Badge>
                ))}
              </div>
              <div className="mt-auto">
                <LaunchButton
                  scenario={s.id}
                  label={s.kind === "attack" ? "Run this attack" : "Run the control"}
                  variant={s.kind === "attack" ? "primary" : "secondary"}
                  disabled={off}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function CustomAttack() {
  await connection();
  const status = await labStatus(await getDb());
  return (
    <CustomAttackForm
      pages={PAGE_TARGETS}
      claudeAvailable={status.claudeAgent}
      disabled={status.mode === "off"}
    />
  );
}

async function RecentRuns() {
  await connection();
  const runs = await recentLabRuns(await getDb());
  if (runs.length === 0) return <p className="text-muted text-sm">No runs yet. Be the first.</p>;
  return (
    <ul className="divide-border flex flex-col divide-y">
      {runs.map((r) => {
        const title =
          r.scenario === "custom" ? "Custom attack" : (getScenario(r.scenario)?.title ?? r.scenario);
        const held = r.outcome?.passed;
        return (
          <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
            <Link href={`/lab/runs/${r.id}`} className="group flex items-start gap-2 text-sm">
              {r.status === "running" ? (
                <span className="bg-primary mt-1.5 size-2 shrink-0 animate-pulse rounded-full" aria-hidden />
              ) : held ? (
                <ShieldCheck className="text-allow mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <ShieldX className="text-block mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span className="flex min-w-0 flex-col">
                <span className="font-medium group-hover:underline">{title}</span>
                <span className="text-muted truncate text-xs">
                  {r.status === "running" ? "Running…" : (r.outcome?.headline ?? "Run failed")}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
