"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown when a page fails to render. Payments are never half-done: every PayPal call is idempotent. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <TriangleAlert className="text-review size-8" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong on this page</h1>
      <p className="text-muted">
        Nothing was paid twice: every PayPal call Leash makes is idempotent, so trying again is safe.
        {error.digest ? (
          <>
            {" "}
            Reference <code className="font-mono text-xs">{error.digest}</code>.
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href="/app" className="text-primary self-center text-sm font-medium hover:underline">
          Back to the control tower
        </Link>
      </div>
    </main>
  );
}
