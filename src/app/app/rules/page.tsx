import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CircleCheck } from "lucide-react";
import { RuleCard } from "@/components/rule-card";
import { RulesForm } from "@/components/rules-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/server/db/client";
import { activeRules, currentWorkspaceId, mandateHistory, workspaceBasics } from "@/server/views";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage({ searchParams }: PageProps<"/app/rules">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Rules searchParams={searchParams} />
    </Suspense>
  );
}

async function Rules({ searchParams }: { searchParams: PageProps<"/app/rules">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const db = await getDb();
  const ws = await currentWorkspaceId();
  const { agent } = await workspaceBasics(db, ws);
  const rules = await activeRules(db, agent.id);
  const history = (await mandateHistory(db, agent.id)).filter((m) => m.status !== "draft");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
        <p className="text-muted">
          Your words are the source of truth. Leash compiles them into rules it can enforce, and shows you
          exactly what it will do.
        </p>
      </div>
      {sp.saved ? (
        <p role="status" className="bg-allow-soft text-allow flex items-center gap-2 rounded-lg p-3 text-sm">
          <CircleCheck className="size-4" aria-hidden /> New rules saved. The guard uses them from the next
          request.
        </p>
      ) : null}
      {rules ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>In force now</CardTitle>
              <Badge tone="neutral">v{rules.version}</Badge>
            </div>
            <CardDescription>&ldquo;{rules.ownerText}&rdquo;</CardDescription>
          </CardHeader>
          <CardContent>
            <RuleCard card={rules.ruleCard} />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Change the rules</CardTitle>
          <CardDescription>Edit in plain English, review the changes, then save.</CardDescription>
        </CardHeader>
        <CardContent>
          <RulesForm defaultText={rules?.ownerText ?? ""} mode="edit" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Every receipt records the version that was in force.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border flex flex-col divide-y text-sm">
            {history.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 py-2">
                <span className="flex items-center gap-2 font-medium">
                  v{m.version}
                  <Badge tone={m.status === "active" ? "allow" : "neutral"}>{m.status}</Badge>
                  <span className="text-subtle font-normal">{m.createdAt.toISOString().slice(0, 10)}</span>
                </span>
                <span className="text-muted line-clamp-2">{m.ownerText}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
