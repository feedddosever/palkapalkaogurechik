import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, FileText, Mail, ShieldCheck, ShieldX } from "lucide-react";
import { LabRunLive } from "@/components/lab/lab-run-live";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/format";
import { getDemoProduct, getDemoSupplier } from "@/server/catalog/demo-suppliers";
import { getDb } from "@/server/db/client";
import { hasInvoice, type StoredAttack } from "@/server/lab/custom";
import { labRunView } from "@/server/lab/runner";
import { getScenario } from "@/server/lab/scenarios";

export const metadata: Metadata = { title: "Attack Lab run" };

export default function LabRunPage({ params }: PageProps<"/lab/runs/[id]">) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pt-2 pb-20 sm:px-6">
        <Link
          href="/lab"
          className="text-muted hover:text-foreground inline-flex items-center gap-1 self-start text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Attack Lab
        </Link>
        <Suspense fallback={<Skeleton className="h-[600px]" />}>
          <LabRun params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function LabRun({ params }: { params: PageProps<"/lab/runs/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const view = await labRunView(await getDb(), id);
  if (!view) notFound();
  const scenario = getScenario(view.scenario);
  const attack = (view.attack ?? null) as StoredAttack | null;
  const done = view.status !== "running";
  const outcome = view.outcome;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={scenario?.kind === "control" ? "allow" : "block"}>
              {scenario?.kind === "control" ? "Control" : "Attack"}
            </Badge>
            <Badge tone="neutral">
              {view.driver === "claude"
                ? "Real Claude agent"
                : scenario?.kind === "control"
                  ? "Honest agent (scripted)"
                  : "Simulated hijacked agent"}
            </Badge>
            <Badge tone={view.aiLayers ? "primary" : "neutral"}>
              {view.aiLayers ? "AI scanner + judge on" : "Rules + heuristic scanner"}
            </Badge>
          </div>
          <CardTitle className="mt-2 text-xl">{scenario?.title ?? "Your custom attack"}</CardTitle>
          <CardDescription>{scenario ? scenario.goal : "Written by a lab visitor."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {scenario ? <p className="text-muted">{scenario.how}</p> : null}
          {attack ? <AttackPreview attack={attack} /> : null}
        </CardContent>
      </Card>

      {done ? (
        <Card
          role="status"
          aria-label="Outcome"
          className={outcome?.passed ? "border-allow/40" : "border-block/40"}
        >
          <CardContent className="flex flex-col gap-4 pt-5">
            <div className="flex items-start gap-3">
              {outcome?.passed ? (
                <ShieldCheck className="text-allow size-8 shrink-0" aria-hidden />
              ) : (
                <ShieldX className="text-block size-8 shrink-0" aria-hidden />
              )}
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold tracking-tight">
                  {view.status === "failed"
                    ? "The run failed before it finished."
                    : outcome?.passed
                      ? "Leash held."
                      : scenario?.kind === "control"
                        ? "Leash got in the way."
                        : "Leash was breached."}
                </p>
                <p className="text-muted">{outcome?.headline ?? "No outcome was recorded."}</p>
              </div>
            </div>
            {outcome ? (
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Blocked" value={outcome.blocked} tone={outcome.blocked ? "allow" : "default"} />
                <Stat
                  label="Sent to Dana"
                  value={outcome.asked}
                  tone={outcome.asked ? "review" : "default"}
                />
                <Stat
                  label={scenario?.kind === "control" ? "Paid" : "Paid to attacker"}
                  value={scenario?.kind === "control" ? outcome.paid : formatMoney(outcome.breachedAmount)}
                  tone={
                    scenario?.kind === "control"
                      ? "allow"
                      : Number(outcome.breachedAmount) > 0
                        ? "block"
                        : "default"
                  }
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/lab" size="sm">
                Try another attack
              </ButtonLink>
              <ButtonLink href="/demo" prefetch={false} size="sm" variant="secondary">
                Set up Leash for a café
              </ButtonLink>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Live: the agent and the guard</CardTitle>
          <CardDescription>
            Every tool call the agent makes, and every decision Leash takes on a payment request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.sandboxGone ? (
            <p className="text-muted text-sm">
              This run&apos;s sandbox café has been cleaned up. The outcome above is kept for the record.
            </p>
          ) : (
            <LabRunLive labRunId={view.id} runId={view.runId} initiallyDone={done} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function AttackPreview({ attack }: { attack: StoredAttack }) {
  if (attack.surface === "page") {
    const product = getDemoProduct(attack.productId);
    const supplier = product ? getDemoSupplier(product.supplierSlug) : undefined;
    return (
      <div className="border-border bg-surface-muted flex flex-col gap-2 rounded-lg border p-3">
        <p className="flex items-center gap-1.5 font-medium">
          <FileText className="size-4" aria-hidden /> Hidden on {supplier?.name}&apos;s page for{" "}
          {product?.name}
        </p>
        <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{attack.text}</p>
      </div>
    );
  }
  return (
    <div className="border-border bg-surface-muted flex flex-col gap-2 rounded-lg border p-3">
      <p className="flex items-center gap-1.5 font-medium">
        <Mail className="size-4" aria-hidden /> {attack.subject}
      </p>
      <p className="text-muted text-xs">
        From {attack.fromName} &lt;{attack.fromEmail}&gt;
        {hasInvoice(attack)
          ? ` · Invoice ${attack.invoiceNumber ?? "LAB-001"}: ${formatMoney(Number(attack.invoiceAmount).toFixed(2))} to ${attack.payTo}`
          : ""}
      </p>
      <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{attack.body}</p>
    </div>
  );
}
