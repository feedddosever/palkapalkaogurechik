import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { FlaskConical, Lock } from "lucide-react";
import { simCheckoutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { getPayPal, SimulatedPayPal } from "@/server/paypal";

export const metadata: Metadata = { title: "PayPal simulator" };

/**
 * Offline stand-in for PayPal's approval page. Deliberately unbranded and clearly labelled:
 * with sandbox keys configured, this step happens on PayPal itself.
 */
export default function SimCheckout({ searchParams }: PageProps<"/sim/paypal/checkout">) {
  return (
    <main className="bg-surface-muted flex flex-1 items-center justify-center px-4 py-10">
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-md" />}>
        <Checkout searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Checkout({
  searchParams,
}: {
  searchParams: PageProps<"/sim/paypal/checkout">["searchParams"];
}) {
  await connection();
  const { token } = await searchParams;
  const orderId = typeof token === "string" ? token : "";
  const paypal = getPayPal();
  if (!(paypal instanceof SimulatedPayPal) || !orderId) {
    return <p className="text-muted text-sm">The PayPal simulator is only used in offline mode.</p>;
  }
  const order = await paypal.getOrder(orderId).catch(() => null);
  if (!order) return <p className="text-muted text-sm">Unknown order.</p>;
  const details = await paypal.orderDetails(orderId);

  return (
    <div className="border-border bg-surface shadow-raised w-full max-w-md overflow-hidden rounded-2xl border">
      <div className="bg-foreground text-background flex items-center gap-2 px-5 py-3 text-sm">
        <FlaskConical className="size-4" aria-hidden />
        PayPal simulator · offline demo, no real account
      </div>
      <div className="flex flex-col gap-5 p-6">
        <div>
          <p className="text-muted text-sm">Leash is asking to hold</p>
          <p className="tabular text-4xl font-semibold tracking-tight">{formatMoney(details.amount)}</p>
          <p className="text-muted mt-1 text-sm">{details.description}</p>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          <li>• This is an authorization hold, not a charge.</li>
          <li>• Leash captures only what your agent is allowed to spend.</li>
          <li>• Whatever is left is released back to you at the end of the week.</li>
          {details.vault ? (
            <li>• Save this PayPal account so next week&apos;s hold can renew automatically.</li>
          ) : null}
        </ul>
        <form action={simCheckoutAction} className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <Button type="submit" name="decision" value="approve" size="lg">
            <Lock aria-hidden /> Approve {formatMoney(details.amount)} hold
          </Button>
          <Button type="submit" name="decision" value="cancel" variant="ghost">
            Cancel
          </Button>
        </form>
        <p className="text-subtle text-xs">Order {orderId}</p>
      </div>
    </div>
  );
}
