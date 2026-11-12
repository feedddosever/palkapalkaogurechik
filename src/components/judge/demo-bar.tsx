import { connection } from "next/server";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { paypalReachable } from "@/server/judge";

/** A slim strip under the app header: reset to a fresh café, and a notice if PayPal's sandbox is down. */
export async function DemoBar() {
  await connection();
  const ok = await paypalReachable();
  return (
    <>
      {ok ? null : (
        <div role="alert" className="bg-review-soft text-review border-review/30 border-b">
          <p className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2 text-sm sm:px-6">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            PayPal&apos;s sandbox isn&apos;t responding right now. Payments will fail until it&apos;s back;
            try again in a minute.
          </p>
        </div>
      )}
      <div className="border-border bg-surface-muted/60 border-b">
        <p className="text-muted mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs sm:px-6">
          <span>Demo: this café is yours alone. Nothing here touches real money.</span>
          <Link
            href="/demo"
            prefetch={false}
            className="hover:text-foreground inline-flex items-center gap-1 font-medium"
          >
            <RotateCcw className="size-3.5" aria-hidden /> Reset demo (fresh café)
          </Link>
        </p>
      </div>
    </>
  );
}
