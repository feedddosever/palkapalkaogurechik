import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Gauge } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { pct, PUBLISHED_JSON, usd } from "@/server/bench/report";
import type { BenchReport } from "@/server/bench/run";
import { ATTACK_KINDS, ATTACK_LABELS, SCENARIOS } from "@/server/bench/scenarios";

export const metadata: Metadata = {
  title: "LeashBench",
  description: "60 payment requests through Leash's guard: rules only, AI only, and layered.",
};

const REPO = "https://github.com/feedddosever/palkapalkaogurechik/blob/main";

export default function BenchPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pt-4 pb-20 sm:px-6 sm:pt-8">
        <section className="flex flex-col gap-4">
          <Badge tone="primary" className="self-start">
            <Gauge aria-hidden /> LeashBench
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Does each layer of the guard pull its weight?
          </h1>
          <p className="text-muted max-w-3xl text-lg text-pretty">
            60 payment requests an ops agent might send Bean There Café&apos;s guard: 30 attacks of ten kinds
            and 30 legitimate requests, some of them deliberately tricky. Each runs through the real guard
            three times: deterministic rules only, the AI layers only (injection scanner + intent judge), and
            both, the way Leash runs.
          </p>
        </section>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Results />
        </Suspense>
        <Catalog />
      </main>
    </div>
  );
}

async function loadReport(): Promise<BenchReport | null> {
  try {
    return JSON.parse(
      await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), PUBLISHED_JSON), "utf8"),
    ) as BenchReport;
  } catch {
    return null;
  }
}

async function Results() {
  await connection();
  const report = await loadReport();
  if (!report) {
    return (
      <Card>
        <CardContent className="text-muted pt-5 text-sm">
          Results are published after a run with Claude live (<code>npm run bench -- --publish</code>). The
          scenarios are below.
        </CardContent>
      </Card>
    );
  }
  return (
    <section className="flex flex-col gap-6" aria-labelledby="results-title">
      <div className="flex flex-col gap-1">
        <h2 id="results-title" className="text-xl font-semibold tracking-tight">
          Results
        </h2>
        <p className="text-muted text-sm">
          Run on {report.generatedAt.slice(0, 10)}{" "}
          {report.aiMode === "live" ? "with Claude live." : "offline (heuristics instead of Claude)."} An
          attack is caught when Leash doesn&apos;t pay it on its own; a false positive is a legitimate request
          treated more strictly than the owner&apos;s rules ask.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {report.configs.map((c) => (
          <Card key={c.config} className={c.config === "layered" ? "border-primary/40" : undefined}>
            <CardHeader>
              <CardTitle>{c.label}</CardTitle>
              <CardDescription>
                {c.attacks.caught} of {c.attacks.total} attacks caught, {c.attacks.blocked} blocked outright
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Stat
                label="Attacks caught"
                value={pct(c.catchRate)}
                tone={c.catchRate === 1 ? "allow" : "default"}
              />
              <Stat
                label="False positives"
                value={pct(c.falsePositiveRate)}
                tone={c.legit.falsePositives ? "review" : "default"}
              />
              <Stat label="Latency p95" value={`${c.latencyMs.p95} ms`} />
              <Stat label="Cost per check" value={usd(c.costPerCheckUsd)} />
              {c.legit.missedApprovals ? (
                <p className="text-review col-span-2 text-sm">
                  Paid {c.legit.missedApprovals} request{c.legit.missedApprovals === 1 ? "" : "s"} the owner
                  wanted to approve first.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <div
        // Focusable so keyboard users can scroll the table sideways on small screens.
        tabIndex={0}
        role="region"
        aria-label="Attacks caught by kind"
        className="border-border focus-visible:ring-primary overflow-x-auto rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
      >
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">Attacks caught by kind and configuration</caption>
          <thead className="bg-surface-muted text-muted text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Attack kind
              </th>
              {report.configs.map((c) => (
                <th key={c.config} scope="col" className="px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ATTACK_KINDS.map((k) => (
              <tr key={k} className="border-border border-t">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {ATTACK_LABELS[k]}
                </th>
                {report.configs.map((c) => (
                  <td key={c.config} className="px-3 py-2 tabular-nums">
                    {c.byKind[k].caught}/{c.byKind[k].total}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Catalog() {
  const attacks = SCENARIOS.filter((s) => s.truth === "attack");
  const legit = SCENARIOS.filter((s) => s.truth === "legit");
  return (
    <section className="grid gap-6 lg:grid-cols-2" aria-labelledby="catalog-title">
      <h2 id="catalog-title" className="text-xl font-semibold tracking-tight lg:col-span-2">
        The scenarios
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>30 attacks</CardTitle>
          <CardDescription>Three of each kind; caught = not paid without the owner.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {ATTACK_KINDS.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <p className="text-sm font-medium">{ATTACK_LABELS[k]}</p>
              <ul className="text-muted flex list-disc flex-col gap-0.5 pl-5 text-sm">
                {attacks
                  .filter((s) => s.kind === k)
                  .map((s) => (
                    <li key={s.id}>{s.title}</li>
                  ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>30 legitimate requests</CardTitle>
          <CardDescription>With what the owner&apos;s rules call for.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 text-sm">
            {legit.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span>{s.title}</span>
                <Badge tone={s.expected === "ALLOW" ? "allow" : "review"}>
                  {s.expected === "ALLOW" ? "pay" : "ask the owner"}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <p className="text-muted text-sm lg:col-span-2">
        Scenarios:{" "}
        <a className="underline" href={`${REPO}/src/server/bench/scenarios.ts`}>
          src/server/bench/scenarios.ts
        </a>
        . Run them yourself with <code>npm run bench</code>.
      </p>
    </section>
  );
}
