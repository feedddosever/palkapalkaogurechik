import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CircleAlert } from "lucide-react";
import { Logo } from "@/components/logo";
import { JudgeHint } from "@/components/judge/judge-hint";
import { RulesForm } from "@/components/rules-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/server/db/client";
import { DEFAULT_OWNER_TEXT } from "@/server/seed/defaults";
import { activeRules, currentWorkspaceId, workspaceBasics } from "@/server/views";

export const metadata: Metadata = { title: "Set up your agent's leash" };

const STEPS = ["Write your rules", "Review what's enforced", "Approve the PayPal hold"];

export default function Onboarding({ searchParams }: PageProps<"/onboarding">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Leash home">
          <Logo />
        </Link>
        <Link href="/app" className="text-muted hover:text-foreground text-sm">
          Skip to control tower
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pb-16 sm:px-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            Give your ops agent a budget, not your wallet
          </h1>
          <ol className="text-muted flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="bg-accent text-accent-foreground flex size-6 items-center justify-center rounded-full text-xs font-semibold">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <OnboardingBody searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function OnboardingBody({ searchParams }: { searchParams: PageProps<"/onboarding">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const db = await getDb();
  const ws = await currentWorkspaceId();
  const { business, agent } = await workspaceBasics(db, ws);
  const rules = await activeRules(db, agent.id);
  return (
    <div className="flex flex-col gap-6">
      {sp.cancelled ? (
        <p role="alert" className="bg-review-soft text-review flex items-center gap-2 rounded-lg p-3 text-sm">
          <CircleAlert className="size-4" aria-hidden /> The PayPal approval was cancelled. Nothing was held.
          You can try again.
        </p>
      ) : null}
      <p className="text-muted">
        <span className="text-foreground font-medium">{business.ownerName}</span> runs {business.name} (
        {business.locations.join(" and ")}). Her ops agent restocks supplies and pays supplier invoices. Here
        are her rules; change anything you like.
      </p>
      <RulesForm defaultText={rules?.ownerText ?? DEFAULT_OWNER_TEXT} mode="onboarding" />
      <Suspense fallback={null}>
        <JudgeHint />
      </Suspense>
    </div>
  );
}
