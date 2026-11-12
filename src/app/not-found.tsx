import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-4 pt-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">That page isn&apos;t here</h1>
        <p className="text-muted">
          It may have been a lab run whose sandbox was cleaned up, or a link from another café.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/demo" prefetch={false}>
            Start a demo café
          </ButtonLink>
          <ButtonLink href="/lab" variant="secondary">
            Attack Lab
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
