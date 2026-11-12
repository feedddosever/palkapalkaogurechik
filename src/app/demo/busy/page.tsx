import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Busy" };

export default function DemoBusy() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-4 pt-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Lots of new cafés from your network</h1>
        <p className="text-muted">
          Each visit to the demo creates a fresh café, so there&apos;s a limit per hour. Your existing café is
          still there.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/app">Open my café</ButtonLink>
          <ButtonLink href="/lab" variant="secondary">
            Try the Attack Lab
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
