import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { RunTimeline } from "@/components/run-timeline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { runView } from "@/server/views";

export const metadata: Metadata = { title: "Agent run" };

export default function RunPage({ params }: PageProps<"/app/runs/[id]">) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href="/app"
        className="text-muted hover:text-foreground inline-flex items-center gap-1 self-start text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden /> Control tower
      </Link>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Run params={params} />
      </Suspense>
    </div>
  );
}

async function Run({ params }: { params: PageProps<"/app/runs/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const run = await runView(id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent console</CardTitle>
        <CardDescription>
          Every step your agent takes, and every decision Leash makes, as it happens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RunTimeline runId={id} initiallyDone={run ? run.status !== "running" : false} />
      </CardContent>
    </Card>
  );
}
